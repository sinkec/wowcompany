// Novice za naslovnico. Uradne WoW novice pridejo z dnevnim cronom (1 HTTP klic na dan, brez
// Blizzard API kvote), objave druščine iz dogodkov (patch, sezona) in ročno iz Guild Master's Office.
import { ConvexError, v } from 'convex/values';
import {
	action,
	internalAction,
	internalMutation,
	mutation,
	query,
	type MutationCtx
} from './_generated/server.js';
import { internal } from './_generated/api.js';
import { requireAdmin } from './lib/access.js';
import { authComponent } from './auth.js';
import { NEWS_PAGE, parseBlizzardNews } from './lib/news.js';

/** Kaj velja za novico iz WoW Forever (ostale se shranijo skrite, Guild Master jih lahko pokaže). */
const FOREVER = /forever|hotfix/i;

const item = v.object({
	key: v.string(),
	title: v.string(),
	summary: v.string(),
	url: v.string(),
	image: v.union(v.string(), v.null()),
	publishedAt: v.number()
});

/** Javni seznam za naslovnico (samo vidne, najnovejše najprej). */
export const list = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		const rows = await ctx.db
			.query('news')
			.withIndex('by_hidden_and_publishedAt', (q) => q.eq('hidden', false))
			.order('desc')
			.take(Math.min(Math.max(limit ?? 7, 1), 20));
		return rows.map((n) => ({
			id: n._id,
			source: n.source,
			title: n.title,
			summary: n.summary,
			url: n.url ?? null,
			image: n.image ?? null,
			publishedAt: n.publishedAt
		}));
	}
});

/** Za Guild Mastra: tudi skrite. */
export const adminList = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const rows = await ctx.db.query('news').withIndex('by_publishedAt').order('desc').take(40);
		return rows.map((n) => ({
			id: n._id,
			source: n.source,
			title: n.title,
			summary: n.summary,
			url: n.url ?? null,
			publishedAt: n.publishedAt,
			hidden: n.hidden
		}));
	}
});

export async function addCompanyNews(
	ctx: MutationCtx,
	key: string,
	title: string,
	summary: string,
	url?: string
) {
	const k = `co:${key}`;
	const prev = await ctx.db
		.query('news')
		.withIndex('by_key', (q) => q.eq('key', k))
		.unique();
	if (prev) return prev._id;
	return ctx.db.insert('news', {
		key: k,
		source: 'company',
		title: title.slice(0, 140),
		summary: summary.slice(0, 600),
		...(url ? { url } : {}),
		publishedAt: Date.now(),
		hidden: false
	});
}

export const post = mutation({
	args: { title: v.string(), summary: v.string(), url: v.optional(v.string()) },
	handler: async (ctx, { title, summary, url }) => {
		await requireAdmin(ctx);
		const t = title.trim();
		if (t.length < 3) throw new ConvexError('A headline, please. Three letters at least.');
		const u = url?.trim();
		if (u && !/^https:\/\//.test(u)) throw new ConvexError('Links must start with https://');
		return addCompanyNews(ctx, `post-${Date.now()}`, t, summary.trim(), u || undefined);
	}
});

export const setHidden = mutation({
	args: { id: v.id('news'), hidden: v.boolean() },
	handler: async (ctx, { id, hidden }) => {
		await requireAdmin(ctx);
		await ctx.db.patch('news', id, { hidden });
		return null;
	}
});

export const remove = mutation({
	args: { id: v.id('news') },
	handler: async (ctx, { id }) => {
		await requireAdmin(ctx);
		await ctx.db.delete('news', id);
		return null;
	}
});

/** Nove uradne novice dodaj, obstoječe pusti (tudi skrite ostanejo skrite). */
export const saveBlizzard = internalMutation({
	args: { items: v.array(item) },
	handler: async (ctx, { items }) => {
		let added = 0;
		for (const n of items) {
			const prev = await ctx.db
				.query('news')
				.withIndex('by_key', (q) => q.eq('key', n.key))
				.unique();
			if (prev) continue;
			await ctx.db.insert('news', {
				key: n.key,
				source: 'blizzard',
				title: n.title,
				summary: n.summary,
				url: n.url,
				...(n.image ? { image: n.image } : {}),
				publishedAt: n.publishedAt,
				// stran je za ves WoW (tudi trgovina, retail): Forever in hotfixi so vidni, ostalo skrito
				hidden: !FOREVER.test(`${n.title} ${n.summary}`)
			});
			added++;
		}
		return added;
	}
});

async function fetchNews(): Promise<{ ok: boolean; items: ReturnType<typeof parseBlizzardNews> }> {
	const res = await fetch(NEWS_PAGE, {
		headers: { 'User-Agent': 'WowCompany fan portal (news headlines, once a day)' }
	});
	if (!res.ok) return { ok: false, items: [] };
	return { ok: true, items: parseBlizzardNews(await res.text()) };
}

/** Cron: enkrat na dan. */
export const refreshBlizzard = internalAction({
	args: {},
	handler: async (ctx): Promise<number> => {
		const { items } = await fetchNews();
		if (!items.length) return 0;
		return ctx.runMutation(internal.news.saveBlizzard, { items });
	}
});

/** Guild Master: "preveri zdaj". */
export const refreshNow = action({
	args: {},
	handler: async (ctx): Promise<{ ok: boolean; found: number; added: number }> => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user || !(await ctx.runQuery(internal.admin.isAdmin, { userId: user._id })))
			throw new ConvexError('Guild Master only.');
		const { ok, items } = await fetchNews();
		const added = items.length
			? await ctx.runMutation(internal.news.saveBlizzard, { items })
			: 0;
		return { ok, found: items.length, added };
	}
});
