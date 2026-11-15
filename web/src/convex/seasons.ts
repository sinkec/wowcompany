// Sezone (particije lestvic, docs/STATS.md §6). Brez vrstic v tabeli = Season 1 od začetka časa.
// Dnevni cron prebere verzijo igre iz Blizzardovega static namespacea; ko se spremenita prvi dve
// številki (1.60 → 1.61), admin v Officeu dobi predlog za novo sezono in jo začne z enim klikom.
import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import {
	internalAction,
	internalMutation,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server.js';
import { requireAdmin } from './lib/access.js';
import { get as bnetGet, staticNs } from './lib/blizzard.js';
import { patchFromNamespace, patchLine } from './lib/parses.js';
import { DEFAULT_SETTINGS, getSettings } from './lib/settings.js';

/** Številka sezone, v katero spada trenutek `at` (UTC ms). */
export async function seasonAt(ctx: QueryCtx | MutationCtx, at: number): Promise<number> {
	const s = await ctx.db
		.query('seasons')
		.withIndex('by_startedAt', (q) => q.lte('startedAt', at))
		.order('desc')
		.first();
	return s?.number ?? 1;
}

/** Vse sezone, najnovejša prva (Season 1 tudi, ko še ni zapisana). */
export async function listSeasons(ctx: QueryCtx) {
	const rows = await ctx.db.query('seasons').withIndex('by_number').order('desc').take(100);
	const out = rows.map((s) => ({
		number: s.number,
		name: s.name,
		startedAt: s.startedAt,
		patch: s.patch
	}));
	if (!out.some((s) => s.number === 1))
		out.push({ number: 1, name: 'Season 1', startedAt: 0, patch: null });
	return out;
}

/** Za Office: sezone, verzija igre in ali je čas za novo sezono. */
export const state = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const seasons = await listSeasons(ctx);
		const current = seasons[0];
		const gamePatch = (await getSettings(ctx)).gamePatch ?? null;
		const suggest =
			gamePatch !== null &&
			current.patch !== null &&
			patchLine(gamePatch) !== patchLine(current.patch);
		return { seasons, current, gamePatch, suggest };
	}
});

/** Admin: začni novo sezono zdaj (stari parsi ostanejo v svoji sezoni). */
export const start = mutation({
	args: { name: v.optional(v.string()) },
	handler: async (ctx, { name }) => {
		await requireAdmin(ctx);
		const last = await ctx.db.query('seasons').withIndex('by_number').order('desc').first();
		const number = (last?.number ?? 1) + 1;
		const patch = (await getSettings(ctx)).gamePatch ?? null;
		if (!last) {
			// Season 1 je bila doslej samo implicitna – zapiši jo, da ima ime in verzijo
			await ctx.db.insert('seasons', { number: 1, name: 'Season 1', startedAt: 0, patch: null });
		}
		const clean = name?.trim().slice(0, 40);
		await ctx.db.insert('seasons', {
			number,
			name: clean || `Season ${number}${patch ? ` (${patchLine(patch)})` : ''}`,
			startedAt: Date.now(),
			patch
		});
		return number;
	}
});

/** Cron: verzija igre iz razrešenega static namespacea (`static-1.60.1_70399-forever-eu`). */
export const checkPatch = internalAction({
	args: {},
	handler: async (ctx) => {
		const res = await bnetGet(['data', 'wow', 'journal-expansion', 'index'], staticNs());
		if (res.status !== 200) return null;
		const href: string = res.body?._links?.self?.href ?? '';
		const patch = patchFromNamespace(href);
		if (patch) await ctx.runMutation(internal.seasons.setGamePatch, { patch });
		return patch;
	}
});

export const setGamePatch = internalMutation({
	args: { patch: v.string() },
	handler: async (ctx, { patch }) => {
		const doc = await ctx.db
			.query('settings')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		if (doc?.gamePatch === patch) return null;
		if (doc) await ctx.db.patch('settings', doc._id, { gamePatch: patch });
		else await ctx.db.insert('settings', { key: 'main', ...DEFAULT_SETTINGS, gamePatch: patch });
		// prva znana verzija = verzija Season 1
		const first = await ctx.db.query('seasons').withIndex('by_number').first();
		if (!first)
			await ctx.db.insert('seasons', { number: 1, name: 'Season 1', startedAt: 0, patch });
		return null;
	}
});
