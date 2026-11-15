// Branje Company Parses iz baze (skupno za portal in Discord bota).
import type { Doc } from '../_generated/dataModel.js';
import type { QueryCtx } from '../_generated/server.js';
import { heroLogs, metricOf, poolKey, standing } from './parses.js';
import { poolDoc } from './pools.js';
import { listSeasons } from '../seasons.js';

/** Najboljši rezultat vsakega junaka v skupini (en dokument `parsePools`, ne vsi parsi – DB I/O). */
export async function poolFor(
	ctx: QueryCtx,
	r: Pick<Doc<'parses'>, 'encounterId' | 'difficultyId' | 'role' | 'season'>
) {
	const doc = await poolDoc(ctx, r);
	return (doc?.entries ?? []).map((e) => ({
		slug: e.slug,
		value: e.value,
		runId: e.runId as string
	}));
}

/** Zavihek Logs (in /parses) za junaka v sezoni (privzeto trenutni). */
export async function loadHeroLogs(ctx: QueryCtx, slug: string, season?: number) {
	const seasons = await listSeasons(ctx);
	const chosen = season ?? seasons[0].number;
	const mine = await ctx.db
		.query('parses')
		.withIndex('by_slug_and_season', (q) => q.eq('slug', slug).eq('season', chosen))
		.take(500);
	const pools = new Map<string, { slug: string; value: number; runId: string }[]>();
	for (const r of mine) {
		const k = poolKey(r);
		if (!pools.has(k)) pools.set(k, await poolFor(ctx, r));
	}
	const logs = heroLogs(
		slug,
		mine.map((r) => ({ ...r, runId: r.runId as string })),
		pools
	);
	// najboljši v druščini po bossu (za primerjavo) + imena (seznam: slugi so lahko cirilični)
	const encounters = logs.encounters.map((e) => {
		const pool = pools.get(poolKey(e)) ?? [];
		const top = pool.reduce<(typeof pool)[number] | null>(
			(a, b) => (!a || b.value > a.value ? b : a),
			null
		);
		return { ...e, top };
	});
	const people = [];
	for (const s of new Set(encounters.flatMap((e) => (e.top ? [e.top.slug] : [])))) {
		const p = await ctx.db
			.query('players')
			.withIndex('by_slug', (q) => q.eq('slug', s))
			.first();
		people.push({ slug: s, name: p?.displayName ?? s });
	}
	return { seasons, season: chosen, ...logs, encounters, people };
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
