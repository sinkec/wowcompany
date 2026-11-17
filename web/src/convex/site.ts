// Vsebina naslovnice: šale v heroju in povezave na skupnost (lib/siteContent.ts).
import { ConvexError, v } from 'convex/values';
import {
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server.js';
import { requireAdmin } from './lib/access.js';
import {
	DEFAULT_CONVOS,
	DEFAULT_QUIPS,
	brandName,
	cleanSocials,
	cleanTeamName,
	parseConvos,
	parseQuips,
	type Social
} from './lib/siteContent.js';

async function content(ctx: QueryCtx | MutationCtx) {
	const doc = await ctx.db
		.query('siteContent')
		.withIndex('by_key', (q) => q.eq('key', 'main'))
		.unique();
	return {
		doc,
		quips: doc?.quips ?? DEFAULT_QUIPS,
		convos: (doc?.convos ?? DEFAULT_CONVOS) as string[][],
		socials: (doc?.socials ?? []) as Social[],
		teamName: doc?.teamName ?? null
	};
}

/** Polno ime strani za Discord in e-pošto ("Ajmer Central WowCompany"). */
export async function siteBrand(ctx: QueryCtx) {
	return brandName((await content(ctx)).teamName);
}

export const brand = internalQuery({ args: {}, handler: (ctx) => siteBrand(ctx) });

/** Javno: naslovnica (šale + povezave). */
export const home = query({
	args: {},
	handler: async (ctx) => {
		const c = await content(ctx);
		return { quips: c.quips, convos: c.convos, socials: c.socials, teamName: c.teamName };
	}
});

/** Guild Master: urejanje. */
export const forAdmin = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const c = await content(ctx);
		return {
			quips: c.quips,
			convos: c.convos,
			socials: c.socials,
			teamName: c.teamName,
			defaults: { quips: DEFAULT_QUIPS, convos: DEFAULT_CONVOS }
		};
	}
});

async function upsert(
	ctx: MutationCtx,
	patch: { quips?: string[]; convos?: string[][]; socials?: Social[]; teamName?: string }
) {
	const { doc, quips, convos, socials } = await content(ctx);
	if (doc) await ctx.db.patch('siteContent', doc._id, patch);
	else await ctx.db.insert('siteContent', { key: 'main', quips, convos, socials, ...patch });
}

export const saveQuips = mutation({
	args: { quips: v.string(), convos: v.string() },
	handler: async (ctx, a) => {
		await requireAdmin(ctx);
		const quips = parseQuips(a.quips);
		const { convos, error } = parseConvos(a.convos);
		if (error) throw new ConvexError(error);
		if (quips.length < 3 && convos.length === 0)
			throw new ConvexError(
				'Keep at least 3 lines or one conversation – the heroes need something to say.'
			);
		await upsert(ctx, { quips, convos });
		return { quips: quips.length, convos: convos.length };
	}
});

export const saveSocials = mutation({
	args: {
		socials: v.array(v.object({ kind: v.string(), url: v.string(), label: v.optional(v.string()) }))
	},
	handler: async (ctx, { socials }) => {
		await requireAdmin(ctx);
		const clean = cleanSocials(socials);
		await upsert(ctx, { socials: clean });
		return clean.length;
	}
});

export const saveTeamName = mutation({
	args: { teamName: v.string() },
	handler: async (ctx, a) => {
		await requireAdmin(ctx);
		const teamName = cleanTeamName(a.teamName);
		await upsert(ctx, { teamName });
		return brandName(teamName);
	}
});
