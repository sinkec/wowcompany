// Stanje zunanjih povezav (Discord) za "Portal Room" v admin dashboardu.
import { internal } from './_generated/api.js';
import { action, query } from './_generated/server.js';
import { authComponent } from './auth.js';
import { requireAdmin } from './lib/access.js';

/** Kaj je nastavljeno (brez razkrivanja skrivnosti). */
export const status = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const site = process.env.SITE_URL ?? null;
		const appId = process.env.DISCORD_APPLICATION_ID ?? null;
		const guildId = process.env.DISCORD_GUILD_ID ?? null;
		const inviteUrl = appId
			? `https://discord.com/oauth2/authorize?client_id=${appId}&scope=applications.commands` +
				(guildId ? `&guild_id=${guildId}&disable_guild_select=true` : '')
			: null;
		return {
			siteUrl: site,
			siteIsPublic: !!site && !/localhost|127\.0\.0\.1/.test(site),
			webhookConfigured: !!process.env.DISCORD_WEBHOOK_URL,
			applicationId: appId,
			guildId,
			inviteUrl,
			interactionsUrl: site ? `${site}/api/discord/interactions` : null
		};
	}
});

type Check = { ok: true; channelId: string; guildId: string | null; name: string } | { ok: false; error: string };

/** Preveri webhook pri Discordu (GET ne objavi ničesar). */
export const checkWebhook = action({
	args: {},
	handler: async (ctx): Promise<Check> => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user || !(await ctx.runQuery(internal.discord.isAdminUser, { userId: user._id })))
			return { ok: false, error: 'Guild Master only.' };
		const url = process.env.DISCORD_WEBHOOK_URL;
		if (!url) return { ok: false, error: 'No webhook configured yet.' };
		const res = await fetch(url);
		if (!res.ok) return { ok: false, error: `Discord says ${res.status}. The webhook was probably deleted.` };
		const d = (await res.json()) as { channel_id: string; guild_id?: string; name?: string };
		return { ok: true, channelId: d.channel_id, guildId: d.guild_id ?? null, name: d.name ?? 'webhook' };
	}
});
