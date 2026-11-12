// Objave v Discord prek webhooka (HTTP, brez stalne povezave). Sproži jih poll.apply ob novih dogodkih.
import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import type { Id } from './_generated/dataModel.js';
import { action, internalAction, internalMutation, internalQuery } from './_generated/server.js';
import { authComponent } from './auth.js';
import { isNewsworthy } from './lib/humor.js';
import { SAMPLE_PAYLOAD, filterPayload, sessionEmbed, type Payload } from './lib/discordEmbed.js';
import { getSettings } from './lib/settings.js';

const MAX_AGE_MS = 6 * 3600 * 1000; // starejših dogodkov ne objavljamo (npr. po izpadu)

/** Discord vidnost (za objave in kasneje slash ukaze). */
export const discordFields = internalQuery({
	args: {},
	handler: async (ctx) => (await getSettings(ctx)).discordFields
});

export const unposted = internalQuery({
	args: {},
	handler: async (ctx) => {
		const events = await ctx.db
			.query('events')
			.withIndex('by_posted', (q) => q.eq('postedAt', undefined))
			.take(40);
		const out = [];
		for (const e of events) {
			const p = await ctx.db.get(e.playerId);
			out.push({ id: e._id, at: e.at, type: e.type, slug: p?.slug ?? null, payload: e.payload as Payload });
		}
		return out;
	}
});

export const markPosted = internalMutation({
	args: { ids: v.array(v.id('events')) },
	handler: async (ctx, { ids }) => {
		const now = Date.now();
		for (const id of ids) await ctx.db.patch(id, { postedAt: now });
	}
});

async function sendWebhook(body: object): Promise<{ ok: boolean; retryAfter?: number; error?: string }> {
	const url = process.env.DISCORD_WEBHOOK_URL;
	if (!url) return { ok: false, error: 'DISCORD_WEBHOOK_URL not set' };
	const res = await fetch(`${url}?wait=true`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: 'Tavern Gossip', allowed_mentions: { parse: [] }, ...body })
	});
	if (res.ok) return { ok: true };
	if (res.status === 429) {
		const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
		return { ok: false, retryAfter: j.retry_after ?? 5 };
	}
	return { ok: false, error: `${res.status} ${await res.text()}` };
}

/** Objavi vse neobjavljene dogodke (do 10 embedov na sporočilo). */
export const postPending = internalAction({
	args: {},
	handler: async (ctx): Promise<{ posted: number; skipped: number }> => {
		if (!process.env.DISCORD_WEBHOOK_URL) return { posted: 0, skipped: 0 };
		type Raw = { id: Id<'events'>; at: number; type: string; slug: string | null; payload: Payload };
		const raw: Raw[] = await ctx.runQuery(internal.discord.unposted, {});
		if (!raw.length) return { posted: 0, skipped: 0 };
		const fields: string[] = await ctx.runQuery(internal.discord.discordFields, {});
		// "Last seen" izklopljen za Discord = objave sej izklopljene (objava razkrije čas odjave)
		const sessionsOn = fields.includes('lastLogin');
		const events = raw.map((e) => ({ ...e, payload: filterPayload(e.payload, fields) }));

		const now = Date.now();
		const skip: Id<'events'>[] = [];
		const send: typeof events = [];
		for (const e of events) {
			if (!sessionsOn || e.type !== 'session' || now - e.at > MAX_AGE_MS || !isNewsworthy(e.payload)) skip.push(e.id);
			else send.push(e);
		}
		if (skip.length) await ctx.runMutation(internal.discord.markPosted, { ids: skip });

		let posted = 0;
		for (let i = 0; i < send.length; i += 10) {
			const batch = send.slice(i, i + 10);
			const r = await sendWebhook({ embeds: batch.map(sessionEmbed) });
			if (r.ok) {
				await ctx.runMutation(internal.discord.markPosted, { ids: batch.map((b) => b.id) });
				posted += batch.length;
			} else if (r.retryAfter) {
				// Discord rate limit: poskusi znova pozneje
				await ctx.scheduler.runAfter(Math.ceil(r.retryAfter * 1000) + 500, internal.discord.postPending, {});
				break;
			} else {
				console.error('Discord webhook:', r.error);
				break;
			}
		}
		return { posted, skipped: skip.length };
	}
});

export const isAdminUser = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		const r = await ctx.db
			.query('roles')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		return r?.role === 'admin';
	}
});

/** Admin: testno sporočilo v kanal (preveri webhook). */
export const sendTest = action({
	args: {},
	handler: async (ctx): Promise<{ ok: boolean; error?: string }> => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user || !(await ctx.runQuery(internal.discord.isAdminUser, { userId: user._id })))
			return { ok: false, error: 'Guild Master only.' };
		const fields: string[] = await ctx.runQuery(internal.discord.discordFields, {});
		return testPostImpl(fields);
	}
});

/** CLI: bunx convex run discord:testPost */
export const testPost = internalAction({
	args: {},
	handler: async (ctx): Promise<{ ok: boolean; error?: string }> => {
		const fields: string[] = await ctx.runQuery(internal.discord.discordFields, {});
		return testPostImpl(fields);
	}
});

async function testPostImpl(fields: string[]): Promise<{ ok: boolean; error?: string }> {
	if (!fields.includes('lastLogin'))
		return { ok: false, error: 'Session posts are off. Flip the master switch in Visibility → Discord first.' };
	const r = await sendWebhook({
		embeds: [
			sessionEmbed({
				id: 'test-' + Date.now(),
				at: Date.now(),
				slug: null,
				payload: filterPayload(SAMPLE_PAYLOAD, fields)
			})
		],
		content: '🧪 Test post from WowCompany. If you can read this, the webhook works. Unlike your rotation.'
	});
	return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'rate limited, try again in a few seconds' };
}
