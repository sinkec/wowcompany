// Discord nastavitve: najprej vrednosti iz admin vmesnika (tabela secrets), sicer okoljske spremenljivke.
import type { QueryCtx } from '../_generated/server.js';

export type DiscordConfig = {
	webhookUrl: string | null;
	webhookName: string | null;
	webhookChannelId: string | null;
	botToken: string | null;
	applicationId: string | null;
	applicationName: string | null;
	publicKey: string | null;
	guildId: string | null;
	source: { webhook: 'web' | 'env' | null; bot: 'web' | 'env' | null };
};

export async function getDiscordConfig(ctx: QueryCtx): Promise<DiscordConfig> {
	const doc = await ctx.db
		.query('secrets')
		.withIndex('by_key', (q) => q.eq('key', 'discord'))
		.unique();
	const env = (k: string) => process.env[k] || null;
	const webhookUrl = doc?.webhookUrl ?? env('DISCORD_WEBHOOK_URL');
	const botToken = doc?.botToken ?? env('DISCORD_BOT_TOKEN');
	return {
		webhookUrl,
		webhookName: doc?.webhookName ?? null,
		webhookChannelId: doc?.webhookChannelId ?? null,
		botToken,
		applicationId: doc?.applicationId ?? env('DISCORD_APPLICATION_ID'),
		applicationName: doc?.applicationName ?? null,
		publicKey: doc?.publicKey ?? env('DISCORD_PUBLIC_KEY'),
		guildId: doc?.guildId ?? env('DISCORD_GUILD_ID'),
		source: {
			webhook: doc?.webhookUrl ? 'web' : webhookUrl ? 'env' : null,
			bot: doc?.botToken ? 'web' : botToken ? 'env' : null
		}
	};
}
