// Čiste funkcije za Companion (brez ctx) – testirane v tests/companion.test.ts.
import type {
	BossDetailPlayer,
	CastFails,
	Award,
	LootDrop,
	PersonalUpload,
	PlayerSummary,
	RunSummary
} from './companionSchema.js';

export const LINK_TTL_MS = 10 * 60_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_PLAYERS = 10;
export const MAX_RUN_MS = 6 * 3_600_000;
export const MAX_AGE_MS = 30 * 86_400_000;
export const MAX_LOOT = 2000;
/** Največ rekordov na igralca (ena vrsta = en rekord). */
export const MAX_RECORDS = 5;
export const MAX_ROLLS = 500;

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
	if (s.leader !== undefined && (s.leader.length < 2 || s.leader.length > 80)) return 'bad leader';
	const loot = s.loot ?? [];
	if (loot.length > MAX_LOOT) return `too much loot (max ${MAX_LOOT})`;
	if (
		loot.some(
			(l) => !l.item || l.item.length > 120 || l.looter.length > 64 || l.count < 1 || l.count > 1000
		)
	)
		return 'bad loot entry';
	const rolls = s.rolls ?? [];
	if (rolls.length > MAX_ROLLS) return `too many rolls (max ${MAX_ROLLS})`;
	if (
		rolls.some(
			(r) =>
				!r.item ||
				r.item.length > 120 ||
				r.entries.length > MAX_PLAYERS ||
				(r.winner !== null && !slugs.has(r.winner)) ||
				r.entries.some(
					(e) =>
						!slugs.has(e.slug) ||
						e.name.length > 64 ||
						(e.roll !== null && !(Number.isInteger(e.roll) && e.roll >= 1 && e.roll <= 100))
				)
		)
	)
		return 'bad roll entry';
	const g = s.progress;
	if (g) {
		const okText = (t: string) => t.length > 0 && t.length <= 80;
		if (
			!(g.xp >= 0 && g.xp <= 10_000_000 && g.xpBonus >= 0 && g.xpBonus <= g.xp) ||
			!(g.copper >= 0 && g.copper <= 1_000_000_000) ||
			g.reputation.length > 50 ||
			g.skills.length > 50 ||
			g.levels.length > 20 ||
			g.reputation.some((r) => !okText(r.faction) || Math.abs(r.amount) > 1_000_000) ||
			g.skills.some((k) => !okText(k.skill) || k.from < 0 || k.to < k.from || k.to > 1000) ||
			g.levels.some((l) => l < 1 || l > 100) ||
			(g.castFails &&
				(g.castFails.total < 0 ||
					g.castFails.total > 100_000 ||
					g.castFails.reasons.length > 20 ||
					g.castFails.reasons.some((r) => !okText(r.name) || r.count < 0)))
		)
			return 'bad progress';
	}
	for (const p of s.players) {
		const recs = p.records ?? [];
		if (recs.length > MAX_RECORDS || new Set(recs.map((r) => r.kind)).size !== recs.length)
			return 'bad records';
		if (
			recs.some(
				(r) =>
					!(r.amount > 0) ||
					!Number.isFinite(r.amount) ||
					!r.spell ||
					r.spell.length > 120 ||
					(r.unit?.length ?? 0) > 120 ||
					r.atMs < 0 ||
					// dogodek je lahko po zadnji aktivnosti (lava po boju), zato meja ni trajanje runa
					r.atMs > MAX_RUN_MS
			)
		)
			return 'bad record entry';
	}
	return null;
}

/** Največ likov v enem pošiljanju osebnih rekordov (glavni + alti na istem računalniku). */
export const MAX_PERSONAL_CHARACTERS = 20;

/** Osebni rekordi iz celega loga: oblika in zdrave meje. */
export function checkPersonal(u: PersonalUpload, now: number): string | null {
	if (u.characters.length < 1 || u.characters.length > MAX_PERSONAL_CHARACTERS)
		return `characters must be 1–${MAX_PERSONAL_CHARACTERS}`;
	const slugs = new Set(u.characters.map((c) => c.slug));
	if (
		slugs.size !== u.characters.length ||
		[...slugs].some((x) => !/^[\p{L}\p{N}'-]{2,64}$/u.test(x))
	)
		return 'bad slugs';
	for (const c of u.characters) {
		if (
			c.records.length > MAX_RECORDS ||
			new Set(c.records.map((r) => r.kind)).size !== c.records.length
		)
			return 'bad records';
		if (
			c.records.some(
				(r) =>
					!(r.amount > 0) ||
					!Number.isFinite(r.amount) ||
					!r.spell ||
					r.spell.length > 120 ||
					(r.unit?.length ?? 0) > 120 ||
					(r.zone?.length ?? 0) > 120 ||
					r.at < now - 366 * 86_400_000 ||
					r.at > now + 86_400_000
			)
		)
			return 'bad record entry';
	}
	return null;
}

/** Rekord, ki premaga shranjenega (ali prvi sploh). */
export function beatsRecord(prev: { amount: number } | null | undefined, next: { amount: number }) {
	return !prev || next.amount > prev.amount;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function top<T>(list: T[], key: (t: T) => number): T | null {
	let best: T | null = null;
	for (const t of list) if (best === null || key(t) > key(best)) best = t;
	return best;
}

/** Šaljive nagrade runa (angleško, WoW ton). */
export function computeAwards(players: PlayerSummary[], loot: LootDrop[] = []): Award[] {
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

	// One-Shot Wonder: največji crit runa.
	const crits = players.flatMap((p) =>
		(p.records ?? []).filter((r) => r.kind === 'crit').map((r) => ({ slug: p.slug, r }))
	);
	const boom = top(crits, (c) => c.r.amount);
	if (boom)
		out.push({
			key: 'oneShotWonder',
			title: 'One-Shot Wonder',
			slug: boom.slug,
			detail: `${fmt(boom.r.amount)} ${boom.r.spell} crit${boom.r.unit ? ` into ${boom.r.unit}` : ''}. Compensating for something.`
		});

	// Loot Goblin: največ pobranih predmetov (vsaj 3).
	const grabbed = new Map<string, number>();
	for (const l of loot) if (l.slug) grabbed.set(l.slug, (grabbed.get(l.slug) ?? 0) + 1);
	const goblin = [...grabbed].sort((a, b) => b[1] - a[1])[0];
	if (goblin && goblin[1] >= 3)
		out.push({
			key: 'lootGoblin',
			title: 'Loot Goblin',
			slug: goblin[0],
			detail: `Grabbed ${goblin[1]} items. Bags full, morals empty.`
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

const DETAIL_KEYS = [
	'spells',
	'heals',
	'casts',
	'targets',
	'buffs',
	'debuffs',
	'timeline',
	'combat'
] as const;
/** neseznamski deli razčlenitve (objekti) */
const OBJECT_KEYS = new Set<string>(['timeline', 'combat']);

/**
 * Razčlenitev boss bojev iz segmentov v ločene dokumente: segmenti ostanejo s seštevki in oznako
 * `hasDetail`, razčlenitev gre v `runBossDetails` (po indeksu segmenta).
 */
export function splitBossDetails(segments: RunSummary['segments']) {
	const details: { index: number; players: BossDetailPlayer[] }[] = [];
	const slim = segments.map((seg, index) => {
		const players: BossDetailPlayer[] = [];
		const slimPlayers = seg.players.map((p) => {
			const has = DETAIL_KEYS.some((k) =>
				OBJECT_KEYS.has(k) ? !!p[k] : ((p[k] as unknown[] | undefined)?.length ?? 0) > 0
			);
			const rest = { ...p };
			for (const k of DETAIL_KEYS) delete rest[k];
			if (!has) return rest;
			const d: BossDetailPlayer = { slug: p.slug };
			for (const k of DETAIL_KEYS) {
				const val = p[k];
				if (OBJECT_KEYS.has(k) ? !!val : ((val as unknown[] | undefined)?.length ?? 0) > 0)
					(d as Record<string, unknown>)[k] = val;
			}
			players.push(d);
			return { ...rest, hasDetail: true };
		});
		if (players.length) details.push({ index, players });
		return { ...seg, players: slimPlayers };
	});
	return { slim, details };
}

/**
 * Nagrade za neuspele caste (črni humor) med snemalci runa – vsak ima v logu samo svoje.
 * Nagrado dobi tisti z največ v vrsti, če preseže prag (tudi ko snema sam).
 */
const FAIL_AWARDS: {
	kind: 'spam' | 'targeting' | 'resources' | 'range' | 'interrupted' | 'control';
	key: string;
	title: string;
	min: number;
	detail: (n: number) => string;
}[] = [
	{
		kind: 'spam',
		key: 'keyboardDiarrhea',
		title: 'Keyboard Diarrhea',
		min: 50,
		detail: (n) => `Pressed it ${n} times before it was ready. The keyboard has filed for divorce.`
	},
	{
		kind: 'targeting',
		key: 'shadowboxer',
		title: 'Shadowboxer',
		min: 20,
		detail: (n) => `${n} spells cast at nothing. Fighting demons only you can see.`
	},
	{
		kind: 'resources',
		key: 'runningOnFumes',
		title: 'Running on Fumes',
		min: 15,
		detail: (n) => `Tried ${n} times on an empty tank. Mana doesn't grow on trees. Mostly.`
	},
	{
		kind: 'range',
		key: 'longDistance',
		title: 'Long-Distance Relationship',
		min: 15,
		detail: (n) =>
			`${n} casts from too far, behind a wall or facing the wrong way. Wrong side of the boss, wrong side of history.`
	},
	{
		kind: 'interrupted',
		key: 'commitmentIssues',
		title: 'Commitment Issues',
		min: 30,
		detail: (n) => `${n} casts ruined by moving or getting kicked. Started strong, finished never.`
	},
	{
		kind: 'control',
		key: 'hostageSituation',
		title: 'Hostage Situation',
		min: 5,
		detail: (n) => `${n} attempts while stunned, silenced or asleep. Struggling is cute.`
	}
];

export function castFailAwards(rows: { slug: string; castFails?: CastFails }[]): Award[] {
	// najslabši v vsaki vrsti nad pragom; razvrščeno po tem, kolikokrat presega prag
	const candidates: { award: Award; ratio: number }[] = [];
	for (const a of FAIL_AWARDS) {
		let best: { slug: string; n: number } | null = null;
		for (const r of rows) {
			const n = r.castFails?.[a.kind] ?? 0;
			if (n >= a.min && (!best || n > best.n)) best = { slug: r.slug, n };
		}
		if (best)
			candidates.push({
				award: { key: a.key, title: a.title, slug: best.slug, detail: a.detail(best.n) },
				ratio: best.n / a.min
			});
	}
	// največ dve sramoti na junaka – tisti dve, kjer je res izstopal
	const perHero = new Map<string, number>();
	return candidates
		.sort((x, y) => y.ratio - x.ratio)
		.filter(({ award }) => {
			const n = perHero.get(award.slug) ?? 0;
			perHero.set(award.slug, n + 1);
			return n < 2;
		})
		.map((c) => c.award);
}
