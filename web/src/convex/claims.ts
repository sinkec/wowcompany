// Zahteve za dodajanje lika: uporabnik oddaja, admin potrdi/zavrne.
import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from './_generated/server.js';
import { authComponent } from './auth.js';
import { getViewer, requireAdmin } from './lib/access.js';
import { get as bnetGet, profileNs, slugify } from './lib/blizzard.js';
import { insertPlayer } from './lib/players.js';

const MAX_PENDING_PER_USER = 3;

const previewValidator = v.object({
	level: v.number(),
	race: v.string(),
	className: v.string(),
	classId: v.number(),
	guild: v.optional(v.string())
});

/** Vrne besedilo napake ali null, če je zahteva dovoljena. */
async function checkClaim(ctx: QueryCtx, userId: string, slug: string): Promise<string | null> {
	const player = await ctx.db
		.query('players')
		.withIndex('by_slug', (q) => q.eq('slug', slug))
		.unique();
	if (player?.active) return 'That hero is already in the company. Identity theft is not a class.';
	const forSlug = await ctx.db
		.query('claims')
		.withIndex('by_slug', (q) => q.eq('slug', slug))
		.collect();
	if (forSlug.some((c) => c.status === 'pending')) return 'Somebody already claimed that one. Waiting for the Guild Master to judge.';
	const mine = await ctx.db
		.query('claims')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.collect();
	if (mine.filter((c) => c.status === 'pending').length >= MAX_PENDING_PER_USER)
		return `You already have ${MAX_PENDING_PER_USER} petitions pending. Patience, greedy one.`;
	return null;
}

export const precheck = internalQuery({
	args: { userId: v.string(), slug: v.string() },
	handler: (ctx, { userId, slug }) => checkClaim(ctx, userId, slug)
});

export const create = internalMutation({
	args: { userId: v.string(), email: v.string(), name: v.string(), slug: v.string(), preview: previewValidator },
	handler: async (ctx, args): Promise<string | null> => {
		const err = await checkClaim(ctx, args.userId, args.slug); // ponovno, atomarno
		if (err) return err;
		await ctx.db.insert('claims', { ...args, status: 'pending', createdAt: Date.now() });
		return null;
	}
});

type SubmitResult =
	| { ok: true; name: string; preview: { level: number; race: string; className: string; classId: number; guild?: string } }
	| { ok: false; error: string };

/** Uporabnik vpiše "Ime Priimek" -> preverba pri Blizzardu -> zahteva čaka na admina. */
export const submit = action({
	args: { name: v.string() },
	handler: async (ctx, { name }): Promise<SubmitResult> => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) return { ok: false, error: 'Sign in first. We need to know who to blame.' };
		const slug = slugify(name);
		if (slug.length < 3 || slug.length > 64 || !/^[\p{L}-]+$/u.test(slug))
			return { ok: false, error: 'That does not look like a name. Try "Firstname Surname".' };

		const pre: string | null = await ctx.runQuery(internal.claims.precheck, { userId: user._id, slug });
		if (pre) return { ok: false, error: pre };

		const r = await bnetGet(['profile', 'wow', 'character', slug], profileNs());
		if (r.status !== 200)
			return {
				ok: false,
				error: `Blizzard has never heard of "${name}". Check the spelling, be level 10+, and log out once so Blizzard notices you exist.`
			};
		const p = r.body;
		const preview = {
			level: Number(p.level ?? 0),
			race: String(p.race?.name ?? ''),
			className: String(p.character_class?.name ?? ''),
			classId: Number(p.character_class?.id ?? 0),
			...(p.guild?.name ? { guild: String(p.guild.name) } : {})
		};
		const displayName = `${p.name ?? ''} ${p.surname ?? ''}`.trim() || name;
		const err: string | null = await ctx.runMutation(internal.claims.create, {
			userId: user._id,
			email: user.email,
			name: displayName,
			slug,
			preview
		});
		if (err) return { ok: false, error: err };
		return { ok: true, name: displayName, preview };
	}
});

/** Moje zahteve + moja vloga. */
export const mine = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await getViewer(ctx);
		if (!viewer) return null;
		const claims = await ctx.db
			.query('claims')
			.withIndex('by_user', (q) => q.eq('userId', viewer.user._id))
			.order('desc')
			.take(20);
		return {
			role: viewer.role,
			claims: claims.map((c) => ({
				id: c._id,
				name: c.name,
				slug: c.slug,
				preview: c.preview,
				status: c.status,
				createdAt: c.createdAt,
				decidedAt: c.decidedAt ?? null
			}))
		};
	}
});

/** Admin: čakajoče + zadnje odločene zahteve. */
export const listForAdmin = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const pending = await ctx.db
			.query('claims')
			.withIndex('by_status', (q) => q.eq('status', 'pending'))
			.collect();
		const decided = (
			await Promise.all(
				(['accepted', 'rejected'] as const).map((s) =>
					ctx.db
						.query('claims')
						.withIndex('by_status', (q) => q.eq('status', s))
						.order('desc')
						.take(10)
				)
			)
		)
			.flat()
			.sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
			.slice(0, 15);
		const map = (c: (typeof pending)[number]) => ({
			id: c._id,
			name: c.name,
			slug: c.slug,
			email: c.email,
			preview: c.preview,
			status: c.status,
			createdAt: c.createdAt,
			decidedAt: c.decidedAt ?? null
		});
		return { pending: pending.sort((a, b) => a.createdAt - b.createdAt).map(map), decided: decided.map(map) };
	}
});

/** Admin: Accept -> igralec se začne spremljati, uporabnik postane član. */
export const decide = mutation({
	args: { claimId: v.id('claims'), accept: v.boolean() },
	handler: async (ctx, { claimId, accept }) => {
		const admin = await requireAdmin(ctx);
		const claim = await ctx.db.get(claimId);
		if (!claim || claim.status !== 'pending') throw new Error('That petition is already handled.');
		if (accept) {
			await insertPlayer(ctx, { slug: claim.slug, displayName: claim.name, ownerUserId: claim.userId });
			const role = await ctx.db
				.query('roles')
				.withIndex('by_user', (q) => q.eq('userId', claim.userId))
				.unique();
			if (!role) {
				await ctx.db.insert('roles', { userId: claim.userId, email: claim.email, role: 'member', createdAt: Date.now() });
			}
		}
		await ctx.db.patch(claimId, {
			status: accept ? 'accepted' : 'rejected',
			decidedAt: Date.now(),
			decidedBy: admin.user._id
		});
	}
});
