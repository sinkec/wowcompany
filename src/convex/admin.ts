// Admin dashboard (javne funkcije s preverbo vloge) + interni CLI ukazi.
//   bunx convex run admin:setPublicFields '{"fields":["name","level"]}'
//   bunx convex run admin:refetchAll
import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import type { Id } from './_generated/dataModel.js';
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server.js';
import { authComponent } from './auth.js';
import { requireAdmin } from './lib/access.js';
import { get as bnetGet, profileNs, slugify } from './lib/blizzard.js';
import { deletePlayer, insertPlayer } from './lib/players.js';
import { ALL_FIELDS, DEFAULT_SETTINGS, getSettings } from './lib/settings.js';

type SettingsPatch = Partial<typeof DEFAULT_SETTINGS> & { discordFields?: string[] };

async function upsertSettings(ctx: MutationCtx, patch: SettingsPatch) {
	const doc = await ctx.db
		.query('settings')
		.withIndex('by_key', (q) => q.eq('key', 'main'))
		.unique();
	if (doc) await ctx.db.patch(doc._id, patch);
	else await ctx.db.insert('settings', { key: 'main', ...DEFAULT_SETTINGS, ...patch });
}

// ---------------------------------------------------------------- dashboard

/** Vse za admin dashboard v eni poizvedbi. */
export const overview = query({
	args: {},
	handler: async (ctx) => {
		const admin = await requireAdmin(ctx);
		const settings = await getSettings(ctx);
		const players = await ctx.db.query('players').collect();
		const roles = await ctx.db.query('roles').collect();
		const emailByUser = new Map(roles.map((r) => [r.userId, r.email]));
		const ps = await ctx.db
			.query('pollState')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		const roster = await ctx.db
			.query('guildRoster')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();

		const summaries = await Promise.all(
			players.map((p) =>
				ctx.db
					.query('summaries')
					.withIndex('by_player', (q) => q.eq('playerId', p._id))
					.unique()
			)
		);

		// groba ocena porabe Convex Free (glej PLAN.md razdelek 8)
		const active = players.filter((p) => p.active).length;
		const runsPerMonth = Math.round((30 * 24 * 3600) / Math.max(60, settings.pollIntervalSec));
		const pollStateBytes = ps ? JSON.stringify(ps.entries).length + 200 : 0;
		const estimate = {
			runsPerMonth,
			functionCalls: runsPerMonth * 2,
			dbReadMB: Math.round((runsPerMonth * (pollStateBytes + 600)) / 1e6),
			computeGBh: Math.round(((runsPerMonth * 1.5) / 3600) * 0.0625 * 100) / 100
		};

		return {
			me: admin.user._id,
			settings: {
				pollIntervalSec: settings.pollIntervalSec,
				paused: settings.paused,
				publicFields: settings.publicFields,
				discordFields: settings.discordFields
			},
			fields: ALL_FIELDS,
			players: players
				.map((p, i) => ({
					id: p._id,
					slug: p.slug,
					displayName: p.displayName,
					active: p.active,
					addedAt: p.addedAt,
					owner: p.ownerUserId ? (emailByUser.get(p.ownerUserId) ?? null) : null,
					level: summaries[i]?.level ?? null,
					className: summaries[i]?.className ?? null,
					classId: summaries[i]?.classId ?? null,
					updatedAt: summaries[i]?.updatedAt ?? null
				}))
				.sort((a, b) => a.displayName.localeCompare(b.displayName)),
			members: roles
				.map((r) => ({ id: r._id, userId: r.userId, email: r.email, name: r.name ?? null, role: r.role, createdAt: r.createdAt }))
				.sort((a, b) => (a.role === b.role ? a.createdAt - b.createdAt : a.role === 'admin' ? -1 : 1)),
			roster: { count: roster?.members.length ?? 0, fetchedAt: roster?.fetchedAt ?? null },
			activePlayers: active,
			estimate
		};
	}
});

export const updateSettings = mutation({
	args: {
		publicFields: v.optional(v.array(v.string())),
		discordFields: v.optional(v.array(v.string())),
		pollIntervalSec: v.optional(v.number()),
		paused: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const patch: SettingsPatch = {};
		if (args.publicFields) patch.publicFields = [...new Set(args.publicFields)];
		if (args.discordFields) patch.discordFields = [...new Set(args.discordFields)];
		if (args.pollIntervalSec !== undefined) patch.pollIntervalSec = Math.min(3600, Math.max(60, Math.round(args.pollIntervalSec)));
		if (args.paused !== undefined) patch.paused = args.paused;
		await upsertSettings(ctx, patch);
	}
});

export const removePlayer = mutation({
	args: { playerId: v.id('players') },
	handler: async (ctx, { playerId }) => {
		await requireAdmin(ctx);
		await deletePlayer(ctx, playerId);
	}
});

/** Odvzame članstvo (admina ni mogoče odstraniti). */
export const revokeMember = mutation({
	args: { roleId: v.id('roles') },
	handler: async (ctx, { roleId }) => {
		await requireAdmin(ctx);
		const role = await ctx.db.get(roleId);
		if (!role) return;
		if (role.role === 'admin') throw new Error('The Guild Master cannot be exiled. Nice try.');
		await ctx.db.delete(roleId);
	}
});

export const isAdmin = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		const r = await ctx.db
			.query('roles')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		return r?.role === 'admin';
	}
});

export const insertPlayerInternal = internalMutation({
	args: { slug: v.string(), displayName: v.string() },
	handler: (ctx, args) => insertPlayer(ctx, args)
});

type AddResult = { ok: true; playerId: Id<'players'>; name: string; level: number } | { ok: false; error: string };

/** Admin doda lika neposredno (brez zahteve). */
export const addPlayer = action({
	args: { name: v.string() },
	handler: async (ctx, { name }): Promise<AddResult> => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user || !(await ctx.runQuery(internal.admin.isAdmin, { userId: user._id })))
			return { ok: false, error: 'Guild Master only.' };
		const slug = slugify(name);
		const r = await bnetGet(['profile', 'wow', 'character', slug], profileNs());
		if (r.status !== 200) return { ok: false, error: `Blizzard has never heard of "${name}".` };
		const displayName = `${r.body.name ?? ''} ${r.body.surname ?? ''}`.trim() || name;
		const playerId: Id<'players'> = await ctx.runMutation(internal.admin.insertPlayerInternal, { slug, displayName });
		return { ok: true, playerId, name: displayName, level: Number(r.body.level ?? 0) };
	}
});

/** Admin: takoj osveži guild roster (predlogi imen). */
export const refreshRoster = action({
	args: {},
	handler: async (ctx): Promise<number> => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user || !(await ctx.runQuery(internal.admin.isAdmin, { userId: user._id }))) throw new Error('Guild Master only.');
		return ctx.runAction(internal.roster.refresh, {});
	}
});

// ---------------------------------------------------------------- CLI (internal)

export const setPublicFields = internalMutation({
	args: { fields: v.array(v.string()) },
	handler: async (ctx, { fields }) => upsertSettings(ctx, { publicFields: fields })
});

export const setPollInterval = internalMutation({
	args: { seconds: v.number(), paused: v.optional(v.boolean()) },
	handler: async (ctx, { seconds, paused }) =>
		upsertSettings(ctx, { pollIntervalSec: Math.max(60, seconds), ...(paused === undefined ? {} : { paused }) })
});

/** Pozabi Last-Modified -> naslednji zagon pollerja prenese vse igralce znova. */
export const refetchAll = internalMutation({
	args: {},
	handler: async (ctx) => {
		const ps = await ctx.db
			.query('pollState')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		if (ps) await ctx.db.patch(ps._id, { entries: ps.entries.map((e) => ({ playerId: e.playerId, slug: e.slug })) });
	}
});
