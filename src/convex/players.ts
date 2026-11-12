import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import type { Doc, Id } from './_generated/dataModel.js';
import { internalAction, internalMutation, query, type QueryCtx } from './_generated/server.js';
import { canSeePrivate } from './lib/access.js';
import { get as bnetGet, profileNs, slugify } from './lib/blizzard.js';
import { getSettings } from './lib/settings.js';
import { insertPlayer } from './lib/players.js';

/** Doda igralca + vnos v pollState (naslednji cron prenese vse podatke). */
export const insert = internalMutation({
	args: { slug: v.string(), displayName: v.string(), ownerUserId: v.optional(v.string()) },
	handler: async (ctx, args) => insertPlayer(ctx, args)
});

/**
 * Ročno dodajanje (CLI / admin): preveri lika pri Blizzardu in ga doda.
 *   bunx convex run players:addByName '{"name":"Sinek Helgater"}'
 */
export const addByName = internalAction({
	args: { name: v.string(), ownerUserId: v.optional(v.string()) },
	handler: async (
		ctx,
		{ name, ownerUserId }
	): Promise<{ playerId: Id<'players'>; slug: string; displayName: string; level: number }> => {
		const slug = slugify(name);
		const r = await bnetGet(['profile', 'wow', 'character', slug], profileNs());
		if (r.status !== 200) throw new Error(`Blizzard ne pozna lika "${name}" (pod lvl 10 ali še ni bil odjavljen?)`);
		const displayName = `${r.body.name} ${r.body.surname ?? ''}`.trim();
		const playerId: Id<'players'> = await ctx.runMutation(internal.players.insert, { slug, displayName, ownerUserId });
		await ctx.runAction(internal.poll.run, { force: true });
		return { playerId, slug, displayName, level: r.body.level };
	}
});

/** Polja, ki jih vidi gledalec (vsa, če je član/admin). */
function pick<T extends Record<string, unknown>>(obj: T, allowed: (k: string) => boolean): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) if (allowed(k)) out[k] = v;
	return out as Partial<T>;
}

async function visibility(ctx: QueryCtx) {
	const [privateOk, settings] = await Promise.all([canSeePrivate(ctx), getSettings(ctx)]);
	const pub = new Set(settings.publicFields);
	return { privateOk, publicFields: settings.publicFields, allowed: (k: string) => privateOk || pub.has(k) };
}

/** Identiteta je vedno vidna (brez nje strani ni mogoče prikazati). */
const ALWAYS = new Set(['_id', 'playerId', 'slug', 'name', 'surname', 'updatedAt']);

/** Stolpec zgodovine -> polje povzetka, ki določa njegovo vidnost. */
const HISTORY_FIELD = {
	level: 'level',
	ilvl: 'ilvlEquipped',
	kills: 'kills',
	deaths: 'deaths',
	quests: 'quests',
	honorableKills: 'honorableKills'
} as const;

/**
 * Sprememba od `since` (začetek 7-dnevnega okna): trenutno stanje minus najstarejši zapis v oknu.
 * `since` pošlje brskalnik (zaokroženo na uro) – poizvedbe ne smejo brati ure (Convex predpomni rezultate).
 */
async function weekDelta(ctx: QueryCtx, playerId: Id<'players'>, s: Doc<'summaries'>, since: number) {
	const first = await ctx.db
		.query('history')
		.withIndex('by_player_at', (q) => q.eq('playerId', playerId).gte('at', since))
		.first();
	if (!first) return { level: 0, ilvl: 0, kills: 0, deaths: 0, quests: 0, honorableKills: 0 };
	return {
		level: s.level - first.level,
		ilvl: s.ilvlEquipped - first.ilvl,
		kills: s.kills - first.kills,
		deaths: s.deaths - first.deaths,
		quests: s.quests - first.quests,
		honorableKills: s.honorableKills - first.honorableKills
	};
}

/** Seznam igralcev za glavno stran (samo majhni povzetki, prirezani na vidna polja). */
export const list = query({
	args: { since: v.optional(v.number()) },
	handler: async (ctx, { since = 0 }) => {
		const { privateOk, publicFields, allowed } = await visibility(ctx);
		const players = await ctx.db.query('players').collect();
		const out = [];
		for (const p of players) {
			if (!p.active) continue;
			const s = await ctx.db
				.query('summaries')
				.withIndex('by_player', (q) => q.eq('playerId', p._id))
				.unique();
			const week = s ? await weekDelta(ctx, p._id, s, since) : null;
			out.push({
				id: p._id,
				slug: p.slug,
				displayName: p.displayName,
				addedAt: p.addedAt,
				summary: s ? pick(s, (k) => ALWAYS.has(k) || allowed(k)) : null,
				// tedenske razlike razkrivajo zasebne številke -> po istih pravilih
				week: week ? pick(week, (k) => allowed(k === 'ilvl' ? 'ilvlEquipped' : k)) : null
			});
		}
		return { private: privateOk, publicFields, players: out };
	}
});

/** Stran lika: povzetek + vidne sekcije podrobnosti + zgodovina + zadnji dogodki. */
export const get = query({
	args: { slug: v.string(), since: v.optional(v.number()) },
	handler: async (ctx, { slug, since = 0 }) => {
		const player = await ctx.db
			.query('players')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		if (!player || !player.active) return null;
		const { privateOk, allowed } = await visibility(ctx);
		const s = await ctx.db
			.query('summaries')
			.withIndex('by_player', (q) => q.eq('playerId', player._id))
			.unique();
		const d = await ctx.db
			.query('details')
			.withIndex('by_player', (q) => q.eq('playerId', player._id))
			.unique();
		const history = allowed('history')
			? await ctx.db
					.query('history')
					.withIndex('by_player_at', (q) => q.eq('playerId', player._id))
					.order('desc')
					.take(1000)
					.then((rows) => rows.reverse())
			: null;
		const week = s ? await weekDelta(ctx, player._id, s, since) : null;
		return {
			private: privateOk,
			player: { id: player._id, slug: player.slug, displayName: player.displayName, addedAt: player.addedAt },
			summary: s ? pick(s, (k) => ALWAYS.has(k) || allowed(k)) : null,
			week: week ? pick(week, (k) => allowed(k === 'ilvl' ? 'ilvlEquipped' : k)) : null,
			details: d
				? {
						render: allowed('avatar') ? (d.render ?? null) : null,
						equipment: allowed('equipment') ? d.equipment : null,
						stats: allowed('stats') ? d.stats : null,
						professions: allowed('professions') ? d.professions : null,
						counters: allowed('counters') ? d.counters : null,
						allStats: allowed('allStats') ? d.allStats : null,
						updatedAt: d.updatedAt
					}
				: null,
			// vsak stolpec zgodovine posebej po pravilih svojega polja (null = skrito)
			history: history
				? history.map((h) => {
						const row: Record<string, number | null> = { at: h.at };
						for (const [col, field] of Object.entries(HISTORY_FIELD))
							row[col] = allowed(field) ? h[col as keyof typeof HISTORY_FIELD] : null;
						return row as { at: number } & Record<keyof typeof HISTORY_FIELD, number | null>;
					})
				: null
		};
	}
});
