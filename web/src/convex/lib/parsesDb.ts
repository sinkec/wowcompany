// Branje Company Parses iz baze (skupno za portal in Discord bota).
import type { Doc } from '../_generated/dataModel.js';
import type { QueryCtx } from '../_generated/server.js';
import { heroLogs, metricOf, poolKey, standing } from './parses.js';
import { listSeasons } from '../seasons.js';

/** Vsi parsi iste skupine (boss + težavnost + vloga + sezona), za primerjavo. ≤ 1000 vrstic. */
export async function poolFor(
	ctx: QueryCtx,
	r: Pick<Doc<'parses'>, 'encounterId' | 'difficultyId' | 'role' | 'season'>
) {
	const rows = await ctx.db
		.query('parses')
		.withIndex('by_encounterId_and_difficultyId_and_role_and_season', (q) =>
			q
				.eq('encounterId', r.encounterId)
				.eq('difficultyId', r.difficultyId)
				.eq('role', r.role)
				.eq('season', r.season)
		)
		.take(1000);
	return rows.map((x) => ({ slug: x.slug, value: metricOf(x) }));
}

/** Zavihek Logs (in /parses) za junaka v sezoni (privzeto trenutni). */
export async function loadHeroLogs(ctx: QueryCtx, slug: string, season?: number) {
	const seasons = await listSeasons(ctx);
	const chosen = season ?? seasons[0].number;
	const mine = await ctx.db
		.query('parses')
		.withIndex('by_slug_and_season', (q) => q.eq('slug', slug).eq('season', chosen))
		.take(500);
	const pools = new Map<string, { slug: string; value: number }[]>();
	for (const r of mine) {
		const k = poolKey(r);
		if (!pools.has(k)) pools.set(k, await poolFor(ctx, r));
	}
	const logs = heroLogs(
		slug,
		mine.map((r) => ({ ...r, runId: r.runId as string })),
		pools
	);
	return { seasons, season: chosen, ...logs };
}

/** Parsi enega runa z mestom med drugimi: po junaku povprečje in najboljši boss. */
export async function runStandings(ctx: QueryCtx, runId: Doc<'runs'>['_id']) {
	const rows = await ctx.db
		.query('parses')
		.withIndex('by_run', (q) => q.eq('runId', runId))
		.take(200);
	const pools = new Map<string, { slug: string; value: number }[]>();
	const by = new Map<string, { pcts: number[]; best: { encounter: string; pct: number } | null }>();
	for (const r of rows) {
		const k = `${poolKey(r)}:${r.season}`;
		if (!pools.has(k)) pools.set(k, await poolFor(ctx, r));
		const { pct } = standing(metricOf(r), r.slug, r.role, pools.get(k)!);
		const e = by.get(r.slug) ?? { pcts: [], best: null };
		if (pct !== null) {
			e.pcts.push(pct);
			if (!e.best || pct > e.best.pct) e.best = { encounter: r.encounter, pct };
		}
		by.set(r.slug, e);
	}
	return [...by.entries()].map(([slug, e]) => ({
		slug,
		avg: e.pcts.length ? Math.round(e.pcts.reduce((a, b) => a + b, 0) / e.pcts.length) : null,
		best: e.best
	}));
}
