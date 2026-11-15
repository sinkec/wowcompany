// Skupna logika dodajanja/odstranjevanja igralcev (uporabljajo players, claims, admin).
import type { Id } from '../_generated/dataModel.js';
import type { MutationCtx } from '../_generated/server.js';

async function pollState(ctx: MutationCtx) {
	return ctx.db
		.query('pollState')
		.withIndex('by_key', (q) => q.eq('key', 'main'))
		.unique();
}

/** Doda igralca (ali ga ponovno aktivira) + vnos v pollState; naslednji cron prenese vse podatke. */
export async function insertPlayer(
	ctx: MutationCtx,
	args: { slug: string; displayName: string; ownerUserId?: string }
): Promise<Id<'players'>> {
	const existing = await ctx.db
		.query('players')
		.withIndex('by_slug', (q) => q.eq('slug', args.slug))
		.unique();
	let playerId: Id<'players'>;
	if (existing) {
		if (existing.active) return existing._id;
		await ctx.db.patch(existing._id, { active: true, ownerUserId: args.ownerUserId ?? existing.ownerUserId });
		playerId = existing._id;
	} else {
		playerId = await ctx.db.insert('players', { ...args, addedAt: Date.now(), active: true });
	}
	const ps = await pollState(ctx);
	const entry = { playerId, slug: args.slug };
	if (ps) {
		if (!ps.entries.some((e) => e.playerId === playerId)) await ctx.db.patch(ps._id, { entries: [...ps.entries, entry] });
	} else {
		await ctx.db.insert('pollState', { key: 'main', entries: [entry] });
	}
	return playerId;
}

/** Odstrani igralca in vse njegove podatke (povzetek, podrobnosti, zgodovina, dogodki). */
export async function deletePlayer(ctx: MutationCtx, playerId: Id<'players'>) {
	const ps = await pollState(ctx);
	if (ps) await ctx.db.patch(ps._id, { entries: ps.entries.filter((e) => e.playerId !== playerId) });
	for (const table of ['summaries', 'details'] as const) {
		const doc = await ctx.db
			.query(table)
			.withIndex('by_player', (q) => q.eq('playerId', playerId))
			.unique();
		if (doc) await ctx.db.delete(doc._id);
	}
	for await (const h of ctx.db.query('history').withIndex('by_player_at', (q) => q.eq('playerId', playerId))) {
		await ctx.db.delete(h._id);
	}
	for await (const e of ctx.db.query('events')) {
		if (e.playerId === playerId) await ctx.db.delete(e._id);
	}
	await ctx.db.delete(playerId);
}
