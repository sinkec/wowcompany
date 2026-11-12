// Discord slash ukazi: odgovori iz internih poizvedb (nikoli javno dosegljivo) + registracija ukazov.
import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import { action, internalQuery, type QueryCtx } from './_generated/server.js';
import { authComponent } from './auth.js';
import { slugify } from './lib/blizzard.js';
import {
	BOARDS,
	COMMANDS,
	boardAllowed,
	heroEmbed,
	leaderboardEmbed,
	rosterEmbed,
	type BotDetails,
	type BotSummary
} from './lib/discordBot.js';
import { getSettings } from './lib/settings.js';

const EPHEMERAL = 64;
const reply = (data: Record<string, unknown>) => ({ type: 4, data: { allowed_mentions: { parse: [] }, ...data } });
const oops = (content: string) => reply({ content, flags: EPHEMERAL });

async function activeSummaries(ctx: QueryCtx) {
	const players = (await ctx.db.query('players').take(200)).filter((p) => p.active);
	const out: (BotSummary & { playerId: (typeof players)[number]['_id']; displayName: string })[] = [];
	for (const p of players) {
		const s = await ctx.db
			.query('summaries')
			.withIndex('by_player', (q) => q.eq('playerId', p._id))
			.unique();
		if (s) out.push({ ...s, playerId: p._id, displayName: p.displayName });
	}
	return out;
}

/** Odgovor na slash ukaz (Discord interaction response JSON). */
export const respond = internalQuery({
	args: { command: v.string(), options: v.record(v.string(), v.string()) },
	handler: async (ctx, { command, options }) => {
		const fields = (await getSettings(ctx)).discordFields;
		const site = process.env.SITE_URL;
		const list = await activeSummaries(ctx);

		if (command === 'roster') return reply({ embeds: [rosterEmbed(list, fields, site)] });

		if (command === 'leaderboard') {
			const embed = leaderboardEmbed(options.board ?? '', list, fields, site);
			return embed ? reply({ embeds: [embed] }) : oops('That board is classified. The Guild Master hid it.');
		}

		if (command === 'hero') {
			const q = (options.name ?? '').trim();
			const slug = slugify(q);
			const hit =
				list.find((s) => s.slug === q || s.slug === slug) ??
				list.find((s) => s.displayName.toLowerCase().includes(q.toLowerCase()));
			if (!hit) return oops(`Never heard of "${q}". Either they don't exist or they're too embarrassing to track.`);
			const d = await ctx.db
				.query('details')
				.withIndex('by_player', (x) => x.eq('playerId', hit.playerId))
				.unique();
			let history = null;
			if (fields.includes('history')) {
				const rows = await ctx.db
					.query('history')
					.withIndex('by_player_at', (x) => x.eq('playerId', hit.playerId))
					.take(500);
				if (rows.length) history = { firstAt: rows[0].at, firstLevel: rows[0].level, changes: rows.length };
			}
			return reply({ embeds: [heroEmbed(hit, (d ?? null) as BotDetails | null, history, fields, site)] });
		}

		return oops('Unknown command. Did you just make that up?');
	}
});

/** Predlogi imen za /hero (max 25). */
export const autocomplete = internalQuery({
	args: { q: v.string() },
	handler: async (ctx, { q }) => {
		const fields = (await getSettings(ctx)).discordFields;
		const needle = q.trim().toLowerCase();
		return (await activeSummaries(ctx))
			.filter((s) => !needle || s.displayName.toLowerCase().includes(needle))
			.sort((a, b) => a.displayName.localeCompare(b.displayName))
			.slice(0, 25)
			.map((s) => ({
				name: [s.displayName, fields.includes('level') ? `lvl ${s.level}` : null, fields.includes('className') ? s.className : null]
					.filter(Boolean)
					.join(' · ')
					.slice(0, 100),
				value: s.slug
			}));
	}
});

export const boards = internalQuery({
	args: {},
	handler: async (ctx) => {
		const fields = (await getSettings(ctx)).discordFields;
		return BOARDS.filter((b) => boardAllowed(b, fields)).map((b) => b.key);
	}
});

type RegisterResult = { ok: true; scope: string; commands: string[] } | { ok: false; error: string };

/** Admin: registrira /roster, /hero, /leaderboard (guild ukazi so vidni takoj). */
export const registerCommands = action({
	args: {},
	handler: async (ctx): Promise<RegisterResult> => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user || !(await ctx.runQuery(internal.discord.isAdminUser, { userId: user._id })))
			return { ok: false, error: 'Guild Master only.' };
		const appId = process.env.DISCORD_APPLICATION_ID;
		const token = process.env.DISCORD_BOT_TOKEN;
		const guildId = process.env.DISCORD_GUILD_ID;
		if (!appId || !token) return { ok: false, error: 'DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN missing in Convex env.' };
		const url = guildId
			? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
			: `https://discord.com/api/v10/applications/${appId}/commands`;
		const res = await fetch(url, {
			method: 'PUT',
			headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(COMMANDS)
		});
		if (!res.ok) {
			const text = await res.text();
			if (res.status === 403 || text.includes('Missing Access'))
				return { ok: false, error: 'Discord says "Missing Access": invite the bot to the server first (button above).' };
			return { ok: false, error: `Discord ${res.status}: ${text.slice(0, 200)}` };
		}
		const body = (await res.json()) as { name: string }[];
		return { ok: true, scope: guildId ? 'server (instant)' : 'global (up to 1h to appear)', commands: body.map((c) => `/${c.name}`) };
	}
});
