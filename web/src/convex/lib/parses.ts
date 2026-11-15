// Company Parses (docs/STATS.md §6): percentil boss killa med spremljanimi junaki druščine.
// Čista logika brez baze – testi v tests/parses.test.ts.
import type { RunSummary } from './companionSchema.js';

export type Role = 'dps' | 'heal' | 'tank';

/** Ena vrstica tabele `parses` (brez runId/playerId/season, ki jih doda mutacija). */
export type ParseRow = {
	slug: string;
	encounterId: number;
	encounter: string;
	zone: string;
	difficultyId: number;
	role: Role;
	dps: number;
	hps: number;
	/** prejeta škoda na sekundo (tanki – samo informativno) */
	taken: number;
	durationMs: number;
	ilvl: number | null;
	/** UTC ms konca boja */
	at: number;
};

/** Pod tem številom drugih junakov percentil nima smisla – pokažemo samo mesto. */
export const MIN_POOL_FOR_PERCENT = 4;

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Vloga v enem boju: zdravilec, če je zdravil več kot tolkel; tank, če je pobral ≥ 45 %
 * vse prejete škode partyja (vsaj 3 igralci); sicer dps.
 */
export function roleOf(
	p: { damage: number; healing: number; damageTaken: number },
	partyTaken: number,
	partySize: number
): Role {
	if (p.healing > p.damage) return 'heal';
	if (partySize >= 3 && partyTaken > 0 && p.damageTaken >= 0.45 * partyTaken) return 'tank';
	return 'dps';
}

/** Parse vrstice runa: vsak ubit boss × igralec, ki je v boju kaj naredil, samo `tracked` slugi. */
export function parseRows(s: RunSummary, tracked: Set<string>): ParseRow[] {
	const rows: ParseRow[] = [];
	for (const seg of s.segments) {
		if (seg.kind !== 'boss' || seg.result !== 'kill' || seg.encounterId === null) continue;
		const durationMs = seg.endMs - seg.startMs;
		if (durationMs < 1000) continue;
		const secs = durationMs / 1000;
		const partyTaken = seg.players.reduce((n, p) => n + p.damageTaken, 0);
		for (const p of seg.players) {
			if (!tracked.has(p.slug) || (p.damage === 0 && p.healing === 0)) continue;
			rows.push({
				slug: p.slug,
				encounterId: seg.encounterId,
				encounter: seg.name,
				zone: s.zone.name,
				difficultyId: s.zone.difficultyId,
				role: roleOf(p, partyTaken, seg.players.length),
				dps: round1(p.damage / secs),
				hps: round1(p.healing / secs),
				taken: round1(p.damageTaken / secs),
				durationMs,
				ilvl: p.ilvl ?? null,
				at: s.startedAt + seg.endMs
			});
		}
	}
	return rows;
}

/** Metrika, po kateri se vloga primerja (tanki se ne točkujejo). */
export const metricOf = (r: { role: Role; dps: number; hps: number }) =>
	r.role === 'heal' ? r.hps : r.dps;

/**
 * Položaj vrednosti `value` junaka `slug` med najboljšimi parsi drugih (en na junaka).
 * `pct` = delež drugih, ki jih je presegel (0–100), `null` pri premalo drugih ali za tanke.
 */
export function standing(
	value: number,
	slug: string,
	role: Role,
	pool: { slug: string; value: number }[]
): { pct: number | null; rank: number; outOf: number } {
	const best = new Map<string, number>();
	for (const p of pool) {
		if (p.slug === slug) continue;
		best.set(p.slug, Math.max(best.get(p.slug) ?? -Infinity, p.value));
	}
	const others = [...best.values()];
	const beaten = others.filter((v) => v < value).length;
	const rank = 1 + others.filter((v) => v > value).length;
	const pct =
		role === 'tank' || others.length < MIN_POOL_FOR_PERCENT
			? null
			: Math.round((100 * beaten) / others.length);
	return { pct, rank, outOf: others.length + 1 };
}

const median = (xs: number[]) => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type HeroKill = {
	runId: string;
	at: number;
	value: number;
	pct: number | null;
	rank: number;
	outOf: number;
	ilvl: number | null;
	durationMs: number;
};

export type HeroEncounter = {
	encounterId: number;
	encounter: string;
	zone: string;
	difficultyId: number;
	role: Role;
	kills: number;
	best: number;
	bestPct: number | null;
	medianPct: number | null;
	fastestMs: number;
	list: HeroKill[];
};

/**
 * Zavihek Logs na strani junaka: po bossu (in vlogi) najboljši, median, najhitrejši uboj, vsi uboji.
 * `pools` = vsi parsi iste skupine (encounter + težavnost + vloga + sezona) za primerjavo.
 */
export function heroLogs(
	slug: string,
	mine: (ParseRow & { runId: string })[],
	pools: Map<string, { slug: string; value: number }[]>
): { encounters: HeroEncounter[]; bestPerfAvg: number | null; medianPerfAvg: number | null } {
	const groups = new Map<string, (ParseRow & { runId: string })[]>();
	for (const r of mine) {
		const k = poolKey(r);
		groups.set(k, [...(groups.get(k) ?? []), r]);
	}
	const encounters: HeroEncounter[] = [];
	for (const [k, rows] of groups) {
		const pool = pools.get(k) ?? [];
		const list: HeroKill[] = rows
			.map((r) => {
				const value = metricOf(r);
				return {
					runId: r.runId,
					at: r.at,
					value,
					...standing(value, slug, r.role, pool),
					ilvl: r.ilvl,
					durationMs: r.durationMs
				};
			})
			.sort((a, b) => b.at - a.at);
		const top = list.reduce((a, b) => (b.value > a.value ? b : a));
		const pcts = list.map((x) => x.pct).filter((x): x is number => x !== null);
		const r0 = rows[0];
		encounters.push({
			encounterId: r0.encounterId,
			encounter: r0.encounter,
			zone: r0.zone,
			difficultyId: r0.difficultyId,
			role: r0.role,
			kills: list.length,
			best: top.value,
			bestPct: top.pct,
			medianPct: median(pcts),
			fastestMs: Math.min(...list.map((x) => x.durationMs)),
			list
		});
	}
	encounters.sort((a, b) => a.zone.localeCompare(b.zone) || a.encounterId - b.encounterId);
	const avg = (xs: (number | null)[]) => {
		const v = xs.filter((x): x is number => x !== null);
		return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
	};
	return {
		encounters,
		bestPerfAvg: avg(encounters.map((e) => e.bestPct)),
		medianPerfAvg: avg(encounters.map((e) => e.medianPct))
	};
}

/** Ključ skupine za primerjavo (sezona je že izbrana s poizvedbo). */
export const poolKey = (r: { encounterId: number; difficultyId: number; role: Role }) =>
	`${r.encounterId}:${r.difficultyId}:${r.role}`;

/** `1.61.2` → `1.61` (nova sezona samo ob spremembi prvih dveh številk). */
export const patchLine = (patch: string) => patch.split('.').slice(0, 2).join('.');

/** Verzija igre iz razrešenega static namespacea: `static-1.60.1_70399-forever-eu` → `1.60.1`. */
export function patchFromNamespace(href: string): string | null {
	const m = href.match(/static-(\d+\.\d+\.\d+)_\d+-/);
	return m ? m[1] : null;
}

export type RankEntry = {
	slug: string;
	value: number;
	runId: string;
	at: number;
	ilvl: number | null;
	durationMs: number;
};
export type RankBoss = {
	encounterId: number;
	encounter: string;
	difficultyId: number;
	dps: RankEntry[];
	heal: RankEntry[];
};

/** Lestvica sezone: po dungeonu in bossu najboljši (en na junaka) DPS in HPS, top `n`. Tanki gredo med DPS. */
export function rankings(
	rows: (ParseRow & { runId: string })[],
	n = 10
): { zone: string; bosses: RankBoss[] }[] {
	const zones = new Map<string, Map<string, RankBoss>>();
	const best = new Map<string, RankEntry>();
	for (const r of rows) {
		const board = r.role === 'heal' ? 'heal' : 'dps';
		const value = board === 'heal' ? r.hps : r.dps;
		if (value <= 0) continue;
		const bossKey = `${r.encounterId}:${r.difficultyId}`;
		const z = zones.get(r.zone) ?? new Map<string, RankBoss>();
		zones.set(r.zone, z);
		if (!z.has(bossKey))
			z.set(bossKey, {
				encounterId: r.encounterId,
				encounter: r.encounter,
				difficultyId: r.difficultyId,
				dps: [],
				heal: []
			});
		const k = `${r.zone}|${bossKey}|${board}|${r.slug}`;
		const prev = best.get(k);
		if (!prev || value > prev.value)
			best.set(k, {
				slug: r.slug,
				value,
				runId: r.runId,
				at: r.at,
				ilvl: r.ilvl,
				durationMs: r.durationMs
			});
	}
	for (const [k, e] of best) {
		const [zone, bossKey, board] = k.split('|');
		zones.get(zone)!.get(bossKey)![board as 'dps' | 'heal'].push(e);
	}
	return [...zones.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([zone, m]) => ({
			zone,
			bosses: [...m.values()]
				.sort((a, b) => a.encounterId - b.encounterId)
				.map((b) => ({
					...b,
					dps: b.dps.sort((x, y) => y.value - x.value).slice(0, n),
					heal: b.heal.sort((x, y) => y.value - x.value).slice(0, n)
				}))
		}));
}

/**
 * Company All-Stars po dungeonu: za vsakega bossa junak dobi `120 × njegov najboljši / najboljši v
 * skupini` (skupina = boss + težavnost + DPS ali Healer tabla; tanki tekmujejo med DPS), vzame se
 * boljša od obeh tabel; točke se seštejejo po dungeonu. Zaokroženo na 0,1.
 */
export function allStars(
	rows: ParseRow[]
): { zone: string; heroes: { slug: string; points: number; bosses: number }[] }[] {
	// najboljši po (dungeon, boss, tabla, junak)
	const best = new Map<string, number>();
	for (const r of rows) {
		const board = r.role === 'heal' ? 'heal' : 'dps';
		const value = board === 'heal' ? r.hps : r.dps;
		if (value <= 0) continue;
		const k = `${r.zone}|${r.encounterId}:${r.difficultyId}|${board}|${r.slug}`;
		best.set(k, Math.max(best.get(k) ?? 0, value));
	}
	const top = new Map<string, number>();
	for (const [k, v] of best) {
		const g = k.slice(0, k.lastIndexOf('|'));
		top.set(g, Math.max(top.get(g) ?? 0, v));
	}
	// točke po (dungeon, boss, junak): boljša tabla
	const perBoss = new Map<string, number>();
	for (const [k, v] of best) {
		const g = k.slice(0, k.lastIndexOf('|'));
		const [zone, boss, , slug] = k.split('|');
		const pts = (120 * v) / (top.get(g) ?? v);
		const key = `${zone}|${boss}|${slug}`;
		perBoss.set(key, Math.max(perBoss.get(key) ?? 0, pts));
	}
	const zones = new Map<string, Map<string, { points: number; bosses: number }>>();
	for (const [k, pts] of perBoss) {
		const [zone, , slug] = k.split('|');
		const z = zones.get(zone) ?? new Map();
		const h = z.get(slug) ?? { points: 0, bosses: 0 };
		h.points += pts;
		h.bosses += 1;
		z.set(slug, h);
		zones.set(zone, z);
	}
	return [...zones.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([zone, m]) => ({
			zone,
			heroes: [...m.entries()]
				.map(([slug, h]) => ({ slug, points: Math.round(h.points * 10) / 10, bosses: h.bosses }))
				.sort((a, b) => b.points - a.points)
		}));
}
