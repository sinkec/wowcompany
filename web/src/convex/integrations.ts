// Portal Room: Discord nastavitve prek admin vmesnika. Skrivnosti so write-only (nikoli nazaj v brskalnik).
import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import { action, internalMutation, internalQuery, mutation, query, type ActionCtx } from './_generated/server.js';
import { authComponent } from './auth.js';
import { requireAdmin } from './lib/access.js';
import { getDiscordConfig, type DiscordConfig } from './lib/discordConfig.js';

const last4 = (s: string | null) => (s ? `…${s.slice(-4)}` : null);

/** Interno: polna konfiguracija (s skrivnostmi) za akcije in HTTP endpoint. */
export const config = internalQuery({
	args: {},
	handler: (ctx): Promise<DiscordConfig> => getDiscordConfig(ctx)
});

/** Admin: stanje povezav BREZ skrivnosti. */
export const status = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const c = await getDiscordConfig(ctx);
		const site = process.env.SITE_URL ?? null;
		const inviteUrl = c.applicationId
			? `https://discord.com/oauth2/authorize?client_id=${c.applicationId}&scope=applications.commands` +
				(c.guildId ? `&guild_id=${c.guildId}&disable_guild_select=true` : '')
			: null;
		return {
			siteUrl: site,
			siteIsPublic: !!site && !/localhost|127\.0\.0\.1/.test(site),
			webhook: {
				configured: !!c.webhookUrl,
				source: c.source.webhook,
				name: c.webhookName,
				channelId: c.webhookChannelId,
				// samo ID webhooka (javni del), žeton ostane skrit
				hint: c.webhookUrl ? c.webhookUrl.replace(/^(https:\/\/[^/]+\/api\/webhooks\/\d+)\/.+$/, '$1/••••') : null
			},
			bot: {
				configured: !!c.botToken,
				source: c.source.bot,
				tokenHint: last4(c.botToken),
				applicationId: c.applicationId,
				applicationName: c.applicationName,
				publicKeySet: !!c.publicKey
			},
			guildId: c.guildId,
			inviteUrl,
			interactionsUrl: site ? `${site}/api/discord/interactions` : null
		};
	}
});

export const patchDiscord = internalMutation({
	args: {
		patch: v.object({
			webhookUrl: v.optional(v.union(v.string(), v.null())),
			webhookName: v.optional(v.union(v.string(), v.null())),
			webhookChannelId: v.optional(v.union(v.string(), v.null())),
			botToken: v.optional(v.union(v.string(), v.null())),
			applicationId: v.optional(v.union(v.string(), v.null())),
			applicationName: v.optional(v.union(v.string(), v.null())),
			publicKey: v.optional(v.union(v.string(), v.null())),
			guildId: v.optional(v.union(v.string(), v.null()))
		})
	},
	handler: async (ctx, { patch }) => {
		// null = izbriši polje (nazaj na rezervo iz env)
		const clean = Object.fromEntries(Object.entries(patch).map(([k, val]) => [k, val ?? undefined]));
		const doc = await ctx.db
			.query('secrets')
			.withIndex('by_key', (q) => q.eq('key', 'discord'))
			.unique();
		if (doc) await ctx.db.patch(doc._id, { ...clean, updatedAt: Date.now() });
		else await ctx.db.insert('secrets', { key: 'discord', ...clean, updatedAt: Date.now() });
	}
});

async function assertAdmin(ctx: ActionCtx) {
	const user = await authComponent.safeGetAuthUser(ctx);
	return !!user && (await ctx.runQuery(internal.discord.isAdminUser, { userId: user._id }));
}

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Shrani webhook po uspešni preverbi pri Discordu (iz njega prebere kanal in strežnik). */
export const saveWebhook = action({
	args: { url: v.string() },
	handler: async (ctx, { url }): Promise<Result> => {
		if (!(await assertAdmin(ctx))) return { ok: false, error: 'Guild Master only.' };
		const clean = url.trim();
		if (!/^https:\/\/(discord|discordapp|canary\.discord|ptb\.discord)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(clean))
			return { ok: false, error: 'That is not a Discord webhook URL. It looks like https://discord.com/api/webhooks/123/abc…' };
		const res = await fetch(clean);
		if (!res.ok) return { ok: false, error: `Discord says ${res.status}. Wrong or deleted webhook.` };
		const d = (await res.json()) as { name?: string; channel_id?: string; guild_id?: string };
		const current: DiscordConfig = await ctx.runQuery(internal.integrations.config, {});
		await ctx.runMutation(internal.integrations.patchDiscord, {
			patch: {
				webhookUrl: clean,
				webhookName: d.name ?? null,
				webhookChannelId: d.channel_id ?? null,
				// strežnik iz webhooka, če ga še nimamo (za takojšnjo registracijo ukazov)
				...(current.guildId ? {} : { guildId: d.guild_id ?? null })
			}
		});
		return { ok: true, message: `Raven nested: "${d.name ?? 'webhook'}" in channel ${d.channel_id}.` };
	}
});

/** Shrani bot token; Application ID in Public Key prebere sam pri Discordu. */
export const saveBot = action({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<Result> => {
		if (!(await assertAdmin(ctx))) return { ok: false, error: 'Guild Master only.' };
		const clean = token.trim().replace(/^Bot\s+/i, '');
		if (clean.length < 50) return { ok: false, error: 'That token is suspiciously short. Copy it again from Developer Portal → Bot.' };
		const res = await fetch('https://discord.com/api/v10/applications/@me', { headers: { Authorization: `Bot ${clean}` } });
		if (!res.ok) return { ok: false, error: `Discord rejected the token (${res.status}). Reset it in Developer Portal → Bot and try again.` };
		const app = (await res.json()) as { id: string; name: string; verify_key: string };
		await ctx.runMutation(internal.integrations.patchDiscord, {
			patch: { botToken: clean, applicationId: app.id, applicationName: app.name, publicKey: app.verify_key }
		});
		return { ok: true, message: `Bot "${app.name}" bound. Application ID and public key picked up automatically.` };
	}
});

/** Ročno nastavljen strežnik (če uporabljaš drug strežnik kot webhook). */
export const setGuild = mutation({
	args: { guildId: v.string() },
	handler: async (ctx, { guildId }) => {
		await requireAdmin(ctx);
		const id = guildId.trim();
		if (!/^\d{17,20}$/.test(id)) throw new Error('Server ID is a 17–20 digit number (right-click server → Copy Server ID).');
		const doc = await ctx.db
			.query('secrets')
			.withIndex('by_key', (q) => q.eq('key', 'discord'))
			.unique();
		if (doc) await ctx.db.patch(doc._id, { guildId: id, updatedAt: Date.now() });
		else await ctx.db.insert('secrets', { key: 'discord', guildId: id, updatedAt: Date.now() });
	}
});

/** Odstrani nastavitve iz vmesnika (ostane morebitna rezerva iz env). */
export const clear = mutation({
	args: { what: v.union(v.literal('webhook'), v.literal('bot')) },
	handler: async (ctx, { what }) => {
		await requireAdmin(ctx);
		const doc = await ctx.db
			.query('secrets')
			.withIndex('by_key', (q) => q.eq('key', 'discord'))
			.unique();
		if (!doc) return;
		if (what === 'webhook') await ctx.db.patch(doc._id, { webhookUrl: undefined, webhookName: undefined, webhookChannelId: undefined, updatedAt: Date.now() });
		else await ctx.db.patch(doc._id, { botToken: undefined, applicationId: undefined, applicationName: undefined, publicKey: undefined, updatedAt: Date.now() });
	}
});

type Check = { ok: true; channelId: string; guildId: string | null; name: string } | { ok: false; error: string };

/** Preveri webhook pri Discordu (GET ne objavi ničesar). */
export const checkWebhook = action({
	args: {},
	handler: async (ctx): Promise<Check> => {
		if (!(await assertAdmin(ctx))) return { ok: false, error: 'Guild Master only.' };
		const c: DiscordConfig = await ctx.runQuery(internal.integrations.config, {});
		if (!c.webhookUrl) return { ok: false, error: 'No webhook configured yet.' };
		const res = await fetch(c.webhookUrl);
		if (!res.ok) return { ok: false, error: `Discord says ${res.status}. The webhook was probably deleted.` };
		const d = (await res.json()) as { channel_id: string; guild_id?: string; name?: string };
		return { ok: true, channelId: d.channel_id, guildId: d.guild_id ?? null, name: d.name ?? 'webhook' };
	}
});
