import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel.js';
import { query } from './_generated/server.js';
import { canSeePrivate } from './lib/access.js';
import { getSettings } from './lib/settings.js';

/** Zadnji dogodki (feed "Tavern Gossip"). Zasebne številke se skrijejo po pravilih javnosti. */
export const recent = query({
	args: { limit: v.optional(v.number()), slug: v.optional(v.string()) },
	handler: async (ctx, { limit, slug }) => {
		const [privateOk, settings] = await Promise.all([canSeePrivate(ctx), getSettings(ctx)]);
		const pub = new Set(settings.publicFields);
		const allowed = (k: string) => privateOk || pub.has(k);

		// čas dogodka = čas odjave -> feed je viden le, če je "Last seen" javen
		if (!allowed('lastLogin')) return [];

		// stran junaka: samo njegovi dogodki prek indeksa (prej: pregled vseh dogodkov vseh junakov)
		const players = new Map<Id<'players'>, Doc<'players'> | null>();
		let rows;
		if (slug) {
			const p = await ctx.db
				.query('players')
				.withIndex('by_slug', (q) => q.eq('slug', slug))
				.unique();
			if (!p?.active) return [];
			players.set(p._id, p);
			rows = ctx.db
				.query('events')
				.withIndex('by_player_id_and_at', (q) => q.eq('playerId', p._id))
				.order('desc');
		} else {
			rows = ctx.db.query('events').withIndex('by_at').order('desc');
		}
		const n = Math.min(limit ?? 15, 50);
		const out = [];
		for await (const e of rows) {
			// vsak junak se prebere enkrat, ne enkrat na dogodek
			if (!players.has(e.playerId)) players.set(e.playerId, await ctx.db.get(e.playerId));
			const player = players.get(e.playerId);
			if (!player?.active) continue;
			const p = e.payload ?? {};
			out.push({
				id: e._id,
				at: e.at,
				type: e.type,
				slug: player.slug,
				name: p.name ?? player.displayName,
				classId: allowed('classId') ? (p.classId ?? 0) : 0,
				avatar: allowed('avatar') ? (p.avatar ?? null) : null,
				level: allowed('level') ? (p.level ?? null) : null,
				ilvl: allowed('ilvlEquipped') ? (p.ilvl ?? null) : null,
				kills: allowed('kills') ? (p.kills ?? 0) : null,
				deaths: allowed('deaths') ? (p.deaths ?? 0) : null,
				quests: allowed('quests') ? (p.quests ?? 0) : null,
				honorableKills: allowed('honorableKills') ? (p.honorableKills ?? 0) : null,
				newItems: allowed('equipment') ? (p.newItems ?? []) : [],
				talentBuild: allowed('talents') ? (p.talentBuild ?? null) : null
			});
			if (out.length >= n) break;
		}
		return out;
	}
});
