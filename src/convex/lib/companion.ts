// Čiste funkcije za Companion (brez ctx) – testirane v tests/companion.test.ts.
import type { Award, PlayerSummary, RunSummary } from './companionSchema.js';

export const LINK_TTL_MS = 10 * 60_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_PLAYERS = 10;
export const MAX_RUN_MS = 6 * 3_600_000;
export const MAX_AGE_MS = 30 * 86_400_000;

const WORDS = [
	'MURLOC',
	'KOBOLD',
	'GNOLL',
	'TROGG',
	'OGRE',
	'WHELP',
	'GHOUL',
	'RAVEN',
	'TAUREN',
	'GOBLIN',
	'HARPY',
	'SATYR',
	'WORGEN',
	'NAGA',
	'CENTAUR',
	'QUILBOAR',
	'DEFIAS',
	'SCOURGE',
	'BANSHEE',
	'MOONKIN'
];

/** Koda za povezavo, npr. `MURLOC-4821`. `rand` vrne 32-bitna nepredznačena števila. */
export function makeLinkCode(rand: () => number): string {
	const word = WORDS[rand() % WORDS.length];
	const num = 1000 + (rand() % 9000);
	return `${word}-${num}`;
}

export function normalizeCode(code: string): string {
	return code.trim().toUpperCase().replace(/\s+/g, '');
}

/** Popolnost posnetka: daljši run in več ubitih bossov = boljši. */
export function runScore(
	s: Pick<RunSummary, 'durationMs' | 'result' | 'segments' | 'deaths'>
): number {
	return (
		s.durationMs + s.result.bossesKilled * 600_000 + s.segments.length * 1000 + s.deaths.length * 10
	);
}

/** Vsebinske omejitve, ki jih validator ne pokrije. Vrne opis napake ali null. */
export function checkRun(s: RunSummary, now: number): string | null {
	if (s.players.length < 1 || s.players.length > MAX_PLAYERS)
		return `players must be 1–${MAX_PLAYERS}`;
	if (!/^[0-9a-f]{16}$/.test(s.runKey)) return 'bad runKey';
	if (s.durationMs <= 0 || s.durationMs > MAX_RUN_MS) return 'bad duration';
	if (s.endReason === 'inProgress') return 'run still in progress';
	if (s.startedAt < now - MAX_AGE_MS || s.startedAt > now + 86_400_000)
		return 'startedAt out of range';
	if (Math.abs(s.endedAt - s.startedAt - s.durationMs) > 1000)
		return 'endedAt does not match duration';
	const slugs = new Set(s.players.map((p) => p.slug));
	if (slugs.size !== s.players.length || [...slugs].some((x) => !/^[\p{L}\p{N}'-]{2,64}$/u.test(x)))
		return 'bad slugs';
	if (s.recorder !== null && !slugs.has(s.recorder)) return 'recorder not in party';
	return null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function top<T>(list: T[], key: (t: T) => number): T | null {
	let best: T | null = null;
	for (const t of list) if (best === null || key(t) > key(best)) best = t;
	return best;
}

/** Šaljive nagrade runa (angleško, WoW ton). */
export function computeAwards(players: PlayerSummary[]): Award[] {
	const out: Award[] = [];
	if (players.length === 0) return out;

	const mvp = top(players, (p) => p.dps);
	if (mvp && mvp.damage > 0)
		out.push({
			key: 'mainCharacter',
			title: 'Main Character',
			slug: mvp.slug,
			detail: `${fmt(mvp.dps)} DPS. Everyone else was an NPC.`
		});

	const floor = top(players, (p) => p.deaths);
	if (floor && floor.deaths > 0)
		out.push({
			key: 'floorInspector',
			title: 'Floor Inspector',
			slug: floor.slug,
			detail: `Inspected the floor ${floor.deaths} time${floor.deaths === 1 ? '' : 's'}. Very thorough. Dead thorough.`
		});

	const pyro = top(players, (p) => p.environmentalTaken);
	if (pyro && pyro.environmentalTaken > 0)
		out.push({
			key: 'pyromaniac',
			title: 'Pyromaniac',
			slug: pyro.slug,
			detail: `Took ${fmt(pyro.environmentalTaken)} damage from lava, fire and gravity. Nature 1, hero 0.`
		});

	const sponge = top(players, (p) => p.damageTaken);
	if (sponge && sponge.damageTaken > 0 && players.length > 1)
		out.push({
			key: 'bulletSponge',
			title: 'Bullet Sponge',
			slug: sponge.slug,
			detail: `Caught ${fmt(sponge.damageTaken)} damage with their face.`
		});

	const over = top(players, (p) => p.overheal);
	if (over && over.overheal > 0 && over.overheal >= over.healing * 0.3)
		out.push({
			key: 'overhealer',
			title: 'Overhealer Supreme',
			slug: over.slug,
			detail: `${fmt(over.overheal)} overhealing. Topping off full health bars like it's a fetish.`
		});

	const kicker = top(players, (p) => p.interrupts);
	if (kicker && kicker.interrupts >= 3)
		out.push({
			key: 'shutUp',
			title: 'Shut Up Button',
			slug: kicker.slug,
			detail: `Interrupted ${kicker.interrupts} casts. Nobody gets to finish a sentence.`
		});

	// Pacifist: najnižji DPS med ne-healerji (vsaj 2 taka v partyju).
	const dealers = players.filter((p) => p.damage > p.healing);
	if (dealers.length >= 2) {
		const paci = top(dealers, (p) => -p.dps);
		if (paci && paci.slug !== mvp?.slug)
			out.push({
				key: 'pacifist',
				title: 'Pacifist',
				slug: paci.slug,
				detail: `${fmt(paci.dps)} DPS. The mobs never felt threatened.`
			});
	}
	return out;
}

/** Dodaj snemalca, če ga še ni (po napravi). */
export function addRecorder<T extends { deviceId: string }>(
	list: T[],
	rec: T
): { list: T[]; added: boolean } {
	if (list.some((r) => r.deviceId === rec.deviceId)) return { list, added: false };
	return { list: [...list, rec], added: true };
}
