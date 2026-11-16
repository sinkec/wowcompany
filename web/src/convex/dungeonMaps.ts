// Zemljevidi dungeonov za replay (glej schema: dungeonMaps). Slika gre v Convex file storage
// (brskalnik jo pred nalaganjem pomanjša v WebP ~150 KB – brezplačna kvota za prenos).
import { v } from 'convex/values';
import { mutation, query } from './_generated/server.js';
import { requireAdmin } from './lib/access.js';
import { visibility } from './runs.js';

const align = v.object({ x: v.number(), y: v.number(), width: v.number(), rotate: v.number() });

export const get = query({
	args: { instanceId: v.number() },
	handler: async (ctx, { instanceId }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs') || !allowed('runDetails')) return null;
		const m = await ctx.db
			.query('dungeonMaps')
			.withIndex('by_instance', (q) => q.eq('instanceId', instanceId))
			.unique();
		if (!m) return null;
		const url = await ctx.storage.getUrl(m.storageId);
		return url ? { url, aspect: m.aspect, align: m.align } : null;
	}
});

export const uploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return ctx.storage.generateUploadUrl();
	}
});

/** Nova slika za dungeon (stara se izbriše). */
export const save = mutation({
	args: {
		instanceId: v.number(),
		zone: v.string(),
		storageId: v.id('_storage'),
		aspect: v.number(),
		align
	},
	handler: async (ctx, a) => {
		await requireAdmin(ctx);
		const meta = await ctx.db.system.get('_storage', a.storageId);
		if (!meta || meta.size > 3_000_000 || !/^image\//.test(meta.contentType ?? '')) {
			await ctx.storage.delete(a.storageId);
			throw new Error('Images only, up to 3 MB.');
		}
		const old = await ctx.db
			.query('dungeonMaps')
			.withIndex('by_instance', (q) => q.eq('instanceId', a.instanceId))
			.unique();
		if (old) {
			await ctx.storage.delete(old.storageId);
			await ctx.db.delete('dungeonMaps', old._id);
		}
		await ctx.db.insert('dungeonMaps', { ...a, updatedAt: Date.now() });
		return null;
	}
});

export const setAlign = mutation({
	args: { instanceId: v.number(), align },
	handler: async (ctx, { instanceId, align }) => {
		await requireAdmin(ctx);
		const m = await ctx.db
			.query('dungeonMaps')
			.withIndex('by_instance', (q) => q.eq('instanceId', instanceId))
			.unique();
		if (!m) throw new Error('No map for this dungeon yet.');
		await ctx.db.patch('dungeonMaps', m._id, { align, updatedAt: Date.now() });
		return null;
	}
});

export const remove = mutation({
	args: { instanceId: v.number() },
	handler: async (ctx, { instanceId }) => {
		await requireAdmin(ctx);
		const m = await ctx.db
			.query('dungeonMaps')
			.withIndex('by_instance', (q) => q.eq('instanceId', instanceId))
			.unique();
		if (m) {
			await ctx.storage.delete(m.storageId);
			await ctx.db.delete('dungeonMaps', m._id);
		}
		return null;
	}
});
