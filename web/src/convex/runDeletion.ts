// Izbris runa: član prosi (z razlogom), Guild Master potrdi ali zavrne v Office → Community → Petitions.
// Guild Master lahko run izbriše tudi sam (s potrditvijo v vmesniku). Izbris počisti vse (companion.removeRun).
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server.js';
import { getViewer, requireAdmin } from './lib/access.js';
import { displayNameOf, profileOf } from './lib/profile.js';
import { removeRun } from './companion.js';

const MAX_REASON = 200;

/** Član: prosi za izbris runa (npr. testni run, napačen party, dvojnik). */
export const request = mutation({
	args: { runId: v.id('runs'), reason: v.string() },
	handler: async (ctx, { runId, reason }) => {
		const viewer = await getViewer(ctx);
		if (viewer?.role !== 'admin' && viewer?.role !== 'member')
			throw new ConvexError('Members only. Strangers don’t get to burn the evidence.');
		const run = await ctx.db.get('runs', runId);
		if (!run) throw new ConvexError('That run is already gone.');
		const text = reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON);
		if (text.length < 3)
			throw new ConvexError('Tell the Guild Master why. Three letters at least.');
		const name = displayNameOf(
			await profileOf(ctx, viewer.user._id),
			viewer.user.name ?? viewer.user.email
		);
		const at = Date.now();
		await ctx.db.patch('runs', runId, {
			deleteRequest: { userId: viewer.user._id, name, reason: text, at },
			deleteRequestedAt: at
		});
		return null;
	}
});

/** Prosilec umakne prošnjo, Guild Master jo zavrne. */
export const cancel = mutation({
	args: { runId: v.id('runs') },
	handler: async (ctx, { runId }) => {
		const viewer = await getViewer(ctx);
		const run = await ctx.db.get('runs', runId);
		if (!run?.deleteRequest) return null;
		if (viewer?.role !== 'admin' && viewer?.user._id !== run.deleteRequest.userId)
			throw new ConvexError('Only who asked, or the Guild Master.');
		await ctx.db.patch('runs', runId, { deleteRequest: undefined, deleteRequestedAt: undefined });
		return null;
	}
});

/** Guild Master: izbriši run (potrdi prošnjo ali sam). */
export const remove = mutation({
	args: { runId: v.id('runs') },
	handler: async (ctx, { runId }) => {
		await requireAdmin(ctx);
		await removeRun(ctx, runId);
		return null;
	}
});

/** Guild Master: odprte prošnje (najstarejše prve). */
export const pending = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const rows = await ctx.db
			.query('runs')
			.withIndex('by_delete_requested_at', (q) => q.gt('deleteRequestedAt', 0))
			.take(50);
		return rows.map((r) => ({
			runId: r._id,
			zone: r.zone.name,
			startedAt: r.startedAt,
			durationMs: r.durationMs,
			party: r.party.map((p) => p.name),
			request: r.deleteRequest!
		}));
	}
});

/** Stran runa: ali obstaja prošnja in ali je moja (za gumb »Request deletion« / »Withdraw«). */
export const status = query({
	args: { runId: v.id('runs') },
	handler: async (ctx, { runId }) => {
		const viewer = await getViewer(ctx);
		if (viewer?.role !== 'admin' && viewer?.role !== 'member') return null;
		const run = await ctx.db.get('runs', runId);
		if (!run) return null;
		const r = run.deleteRequest;
		return {
			isAdmin: viewer.role === 'admin',
			request: r
				? { name: r.name, reason: r.reason, at: r.at, mine: r.userId === viewer.user._id }
				: null
		};
	}
});
