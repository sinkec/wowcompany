// Vzdrževanje `parsePools` (najboljši parse junaka po skupini) in `clears`. Kliče se ob zapisu parsov.
import type { Doc, Id } from '../_generated/dataModel.js';
import type { MutationCtx, QueryCtx } from '../_generated/server.js';
import { metricOf } from './parses.js';

type Group = Pick<Doc<'parses'>, 'encounterId' | 'difficultyId' | 'role' | 'season'>;
type Entry = Doc<'parsePools'>['entries'][number];

const groupKey = (g: Group) => `${g.encounterId}:${g.difficultyId}:${g.role}:${g.season}`;

export async function poolDoc(ctx: QueryCtx, g: Group) {
	return ctx.db
		.query('parsePools')
		.withIndex('by_encounterId_and_difficultyId_and_role_and_season', (q) =>
			q
				.eq('encounterId', g.encounterId)
				.eq('difficultyId', g.difficultyId)
				.eq('role', g.role)
				.eq('season', g.season)
		)
		.unique();
}

const entryOf = (r: Doc<'parses'>): Entry => ({
	slug: r.slug,
	value: metricOf(r),
	runId: r.runId,
	at: r.at,
	ilvl: r.ilvl,
	durationMs: r.durationMs
});

/** Skupina na novo iz parsov (redko: zamenjan ali izbrisan run). ≤ 2000 vrstic. */
async function rebuild(
	ctx: MutationCtx,
	g: Group,
	sample: Pick<Doc<'parses'>, 'encounter' | 'zone'>
) {
	const rows = await ctx.db
		.query('parses')
		.withIndex('by_encounterId_and_difficultyId_and_role_and_season', (q) =>
			q
				.eq('encounterId', g.encounterId)
				.eq('difficultyId', g.difficultyId)
				.eq('role', g.role)
				.eq('season', g.season)
		)
		.take(2000);
	const best = new Map<string, Entry>();
	for (const r of rows) {
		const e = entryOf(r);
		if (!best.has(r.slug) || e.value > best.get(r.slug)!.value) best.set(r.slug, e);
	}
	const doc = await poolDoc(ctx, g);
	const entries = [...best.values()].sort((a, b) => b.value - a.value);
	if (doc && !entries.length) await ctx.db.delete('parsePools', doc._id);
	else if (doc) await ctx.db.patch('parsePools', doc._id, { entries });
	else if (entries.length) await ctx.db.insert('parsePools', { ...g, ...sample, entries });
}

/**
 * Po zapisu parsov runa: nove vrstice se vpišejo, če so junakov najboljši rezultat; skupine, kjer je
 * bil najboljši ravno iz pobrisanih vrstic (isti run), se preračunajo iz parsov.
 */
export async function updatePools(
	ctx: MutationCtx,
	removed: Doc<'parses'>[],
	added: Doc<'parses'>[]
) {
	const stale = new Map<string, Doc<'parses'>>();
	for (const r of removed) {
		const doc = await poolDoc(ctx, r);
		if (doc?.entries.some((e) => e.slug === r.slug && e.runId === r.runId))
			stale.set(groupKey(r), r);
	}
	for (const [, r] of stale) await rebuild(ctx, r, r);
	for (const r of added) {
		if (stale.has(groupKey(r))) continue; // že preračunana z novimi vrsticami vred
		const doc = await poolDoc(ctx, r);
		const e = entryOf(r);
		if (!doc) {
			await ctx.db.insert('parsePools', {
				encounterId: r.encounterId,
				difficultyId: r.difficultyId,
				role: r.role,
				season: r.season,
				encounter: r.encounter,
				zone: r.zone,
				entries: [e]
			});
			continue;
		}
		const old = doc.entries.find((x) => x.slug === r.slug);
		if (old && old.value >= e.value) continue;
		const entries = [...doc.entries.filter((x) => x.slug !== r.slug), e].sort(
			(a, b) => b.value - a.value
		);
		await ctx.db.patch('parsePools', doc._id, { entries });
	}
}

/** `clears` za run: stara vrstica ven, nova noter, če je dungeon očiščen. */
export async function writeClear(
	ctx: MutationCtx,
	runId: Id<'runs'>,
	run: {
		zone: { name: string };
		durationMs: number;
		startedAt: number;
		result: { cleared: boolean };
	},
	party: { slug: string; name: string; deaths: number }[],
	season: number | null
) {
	for await (const old of ctx.db.query('clears').withIndex('by_run', (q) => q.eq('runId', runId))) {
		await ctx.db.delete('clears', old._id);
	}
	if (!run.result.cleared || season === null) return;
	await ctx.db.insert('clears', {
		runId,
		season,
		zone: run.zone.name,
		durationMs: run.durationMs,
		startedAt: run.startedAt,
		deaths: party.reduce((n, p) => n + p.deaths, 0),
		party: party.map((p) => ({ slug: p.slug, name: p.name }))
	});
}
