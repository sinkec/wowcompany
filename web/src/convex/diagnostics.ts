// Diagnostika addona (Logging → "Help development"): Companion pošlje poročilo, ki ga addon zapiše ob
// odjavi/reloadu. Oblike podatkov in številke, brez imen drugih igralcev. Samo za Guild Mastra.
import { ConvexError, v } from 'convex/values';
import { internalMutation, query } from './_generated/server.js';
import { requireAdmin } from './lib/access.js';

export const MAX_REPORT = 100_000;
// oblika napake, ki jo companionHttp.errorResponse pretvori v HTTP status
const fail = (code: 'unauthorized' | 'bad_request', message: string): never => {
	throw new ConvexError({ code, message, retryAfter: null });
};
const KEEP_PER_DEVICE = 3;

export const ingest = internalMutation({
	args: {
		tokenHash: v.string(),
		addonVersion: v.string(),
		appVersion: v.string(),
		at: v.number(),
		report: v.string()
	},
	handler: async (ctx, a) => {
		const device = await ctx.db
			.query('devices')
			.withIndex('by_token_hash', (q) => q.eq('tokenHash', a.tokenHash))
			.unique();
		if (!device || device.revokedAt) return fail('unauthorized', 'Unknown or revoked device.');
		if (a.report.length > MAX_REPORT) fail('bad_request', 'Report too big.');
		try {
			JSON.parse(a.report);
		} catch {
			fail('bad_request', 'Report is not JSON.');
		}
		const mine = await ctx.db
			.query('diagnostics')
			.withIndex('by_device_and_at', (q) => q.eq('deviceId', device._id))
			.order('desc')
			.take(20);
		if (mine.some((d) => d.at === a.at)) return { stored: false };
		await ctx.db.insert('diagnostics', {
			deviceId: device._id,
			userId: device.userId,
			addonVersion: a.addonVersion.slice(0, 20),
			appVersion: a.appVersion.slice(0, 20),
			at: a.at,
			receivedAt: Date.now(),
			report: a.report
		});
		for (const old of mine.slice(KEEP_PER_DEVICE - 1)) await ctx.db.delete('diagnostics', old._id);
		return { stored: true };
	}
});

/** Guild Master: zadnja poročila (brez vsebine – ta se naloži ob kliku). */
export const list = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const rows = await ctx.db
			.query('diagnostics')
			.withIndex('by_receivedAt')
			.order('desc')
			.take(30);
		const out = [];
		for (const d of rows) {
			const device = await ctx.db.get('devices', d.deviceId);
			const role = await ctx.db
				.query('roles')
				.withIndex('by_user', (q) => q.eq('userId', d.userId))
				.unique();
			out.push({
				id: d._id,
				device: device?.name ?? 'gone',
				user: role?.name ?? role?.email ?? 'someone',
				addonVersion: d.addonVersion,
				appVersion: d.appVersion,
				at: d.at,
				size: d.report.length
			});
		}
		return out;
	}
});

export const get = query({
	args: { id: v.id('diagnostics') },
	handler: async (ctx, { id }) => {
		await requireAdmin(ctx);
		return (await ctx.db.get('diagnostics', id))?.report ?? null;
	}
});
