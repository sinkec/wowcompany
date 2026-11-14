// Dungeon Runs na portalu (Companion C5). Vidnost: polja runs / runDetails / runDeaths (+ classId) v lib/runsView.ts.
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel.js';
import { query, type QueryCtx } from './_generated/server.js';
import { canSeePrivate } from './lib/access.js';
import { recordKind } from './lib/companionSchema.js';
import { runDetail, runListItem, type DetailsLike, type RunDocLike } from './lib/runsView.js';
import { getSettings } from './lib/settings.js';

async function visibility(ctx: QueryCtx) {
	const [privateOk, settings] = await Promise.all([canSeePrivate(ctx), getSettings(ctx)]);
	const pub = new Set(settings.publicFields);
	return { privateOk, allowed: (k: string) => privateOk || pub.has(k) };
}

/** slug -> classId za člane partyja, ki jih portal spremlja. */
async function classesFor(ctx: QueryCtx, runs: Doc<'runs'>[]) {
	const slugs = new Set(runs.flatMap((r) => r.party.filter((p) => p.playerId).map((p) => p.slug)));
	const out = new Map<string, number>();
	for (const slug of slugs) {
		const s = await ctx.db
			.query('summaries')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.first();
		if (s) out.set(slug, s.classId);
	}
	return out;
}

/** Kaj gledalec sme videti (za sporočila "members only" v UI). */
export const access = query({
	args: {},
	handler: async (ctx) => {
		const { privateOk, allowed } = await visibility(ctx);
		return {
			private: privateOk,
			runs: allowed('runs'),
			details: allowed('runDetails'),
			deaths: allowed('runDeaths')
		};
	}
});

/** Seznam runov, najnovejši prvi (paginirano). */
export const list = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, { paginationOpts }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs')) return { page: [], isDone: true, continueCursor: '' };
		const res = await ctx.db
			.query('runs')
			.withIndex('by_started_at')
			.order('desc')
			.paginate(paginationOpts);
		const classOf = await classesFor(ctx, res.page);
		return { ...res, page: res.page.map((r) => runListItem(r as RunDocLike, classOf, allowed)) };
	}
});

/** En run z analizo (prirezano po vidnosti). */
export const get = query({
	args: { id: v.string() },
	handler: async (ctx, { id }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs')) return { locked: true as const };
		const runId = ctx.db.normalizeId('runs', id);
		const run = runId ? await ctx.db.get('runs', runId) : null;
		if (!run) return null;
		const details =
			allowed('runDetails') || allowed('runDeaths') || allowed('runLoot')
				? await ctx.db
						.query('runDetails')
						.withIndex('by_run', (q) => q.eq('runId', run._id))
						.unique()
				: null;
		const classOf = await classesFor(ctx, [run]);
		return {
			locked: false as const,
			run: runDetail(run as RunDocLike, details as DetailsLike | null, classOf, allowed)
		};
	}
});

/** Runi enega junaka (zavihek na strani junaka). */
export const forHero = query({
	args: { slug: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { slug, limit = 20 }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs')) return { locked: true as const, runs: [], records: null };
		const parts = await ctx.db
			.query('runParticipants')
			.withIndex('by_slug_and_started_at', (q) => q.eq('slug', slug))
			.order('desc')
			.take(Math.min(50, Math.max(1, limit)));
		const runs = (await Promise.all(parts.map((p) => ctx.db.get('runs', p.runId)))).filter(
			(r): r is Doc<'runs'> => r !== null
		);
		const classOf = await classesFor(ctx, runs);
		// osebni rekordi (≤ 5 majhnih vrstic); številke -> polje runDetails
		const records = allowed('runDetails')
			? (
					await ctx.db
						.query('heroRecords')
						.withIndex('by_slug_and_kind', (q) => q.eq('slug', slug))
						.take(10)
				).map(recordView)
			: null;
		return {
			locked: false as const,
			runs: runs.map((r) => runListItem(r as RunDocLike, classOf, allowed)),
			records
		};
	}
});

const recordView = (r: Doc<'heroRecords'>) => ({
	slug: r.slug,
	kind: r.kind,
	amount: r.amount,
	spell: r.spell,
	unit: r.unit,
	pet: r.pet,
	runId: r.runId,
	zone: r.zone,
	at: r.at
});

/**
 * Lestvica: največji rekord ene vrste med vsemi junaki (privzeto crit). null = skrito.
 * Bere samo majhne vrstice heroRecords – imena in razrede ima glavna stran že iz players.list.
 */
export const topRecords = query({
	args: { kind: v.optional(recordKind), limit: v.optional(v.number()) },
	handler: async (ctx, { kind = 'crit', limit = 10 }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs') || !allowed('runDetails')) return null;
		const rows = await ctx.db
			.query('heroRecords')
			.withIndex('by_kind_and_amount', (q) => q.eq('kind', kind))
			.order('desc')
			.take(Math.min(25, Math.max(1, limit)));
		return rows.map(recordView);
	}
});
