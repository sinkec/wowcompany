// Uporabniške nastavitve: profil (ime, priimek, glavni junak) in lastni junaki (alti).
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel.js';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server.js';
import { getViewer } from './lib/access.js';
import { deletePlayer } from './lib/players.js';
import { profileOf } from './lib/profile.js';

async function requireViewer(ctx: QueryCtx) {
	const viewer = await getViewer(ctx);
	if (!viewer) throw new ConvexError('Sign in first. Ghosts have no settings.');
	return viewer;
}

async function ownedPlayer(ctx: MutationCtx, userId: string, playerId: Id<'players'>) {
	const p = await ctx.db.get('players', playerId);
	if (!p || p.ownerUserId !== userId) throw new ConvexError("That's not your hero. Nice try.");
	return p;
}

/** Vse za stran /settings. */
export const mine = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await getViewer(ctx);
		if (!viewer) return null;
		const userId = viewer.user._id;
		const profile = await profileOf(ctx, userId);
		const players = await ctx.db
			.query('players')
			.withIndex('by_owner', (q) => q.eq('ownerUserId', userId))
			.take(50);
		const characters = await Promise.all(
			players.map(async (p) => {
				const s = await ctx.db
					.query('summaries')
					.withIndex('by_player', (q) => q.eq('playerId', p._id))
					.unique();
				return {
					id: p._id,
					slug: p.slug,
					name: p.displayName,
					active: p.active,
					addedAt: p.addedAt,
					level: s?.level ?? null,
					classId: s?.classId ?? null,
					className: s?.className ?? null,
					race: s?.race ?? null,
					avatar: s?.avatar ?? null,
					ilvl: s?.ilvlEquipped ?? null,
					lastLogin: s?.lastLogin ?? null
				};
			})
		);
		const claims = await ctx.db
			.query('claims')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.order('desc')
			.take(20);
		const googleName = viewer.user.name ?? '';
		const [gFirst = '', ...gRest] = googleName.split(' ');
		return {
			email: viewer.user.email,
			image: viewer.user.image ?? null,
			role: viewer.role,
			memberSince: viewer.user.createdAt ?? null,
			profile: {
				firstName: profile?.firstName ?? gFirst,
				lastName: profile?.lastName ?? gRest.join(' '),
				mainSlug: profile?.mainSlug ?? characters[0]?.slug ?? null,
				saved: !!profile
			},
			characters: characters.sort((a, b) => (b.level ?? 0) - (a.level ?? 0)),
			petitions: claims
				.filter((c) => c.status !== 'accepted')
				.map((c) => ({
					id: c._id,
					name: c.name,
					status: c.status,
					preview: c.preview,
					createdAt: c.createdAt
				}))
		};
	}
});

async function upsertProfile(
	ctx: MutationCtx,
	userId: string,
	patch: Partial<Omit<Doc<'profiles'>, '_id' | '_creationTime' | 'userId'>>
) {
	const existing = await profileOf(ctx, userId);
	if (existing) {
		await ctx.db.patch('profiles', existing._id, { ...patch, updatedAt: Date.now() });
	} else {
		await ctx.db.insert('profiles', {
			userId,
			firstName: patch.firstName ?? '',
			lastName: patch.lastName ?? '',
			...(patch.mainSlug ? { mainSlug: patch.mainSlug } : {}),
			updatedAt: Date.now()
		});
	}
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export const updateName = mutation({
	args: { firstName: v.string(), lastName: v.string() },
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const firstName = clean(args.firstName);
		const lastName = clean(args.lastName);
		if (!firstName) throw new ConvexError('Even orcs have a first name.');
		if (firstName.length > 40 || lastName.length > 40)
			throw new ConvexError('That name is longer than a Tauren questline.');
		await upsertProfile(ctx, viewer.user._id, { firstName, lastName });
		// ime tudi v seznamu članov (Office → Members)
		const role = await ctx.db
			.query('roles')
			.withIndex('by_user', (q) => q.eq('userId', viewer.user._id))
			.unique();
		if (role) await ctx.db.patch('roles', role._id, { name: `${firstName} ${lastName}`.trim() });
		return null;
	}
});

export const setMain = mutation({
	args: { playerId: v.id('players') },
	handler: async (ctx, { playerId }) => {
		const viewer = await requireViewer(ctx);
		const p = await ownedPlayer(ctx, viewer.user._id, playerId);
		const profile = await profileOf(ctx, viewer.user._id);
		const [gFirst = '', ...gRest] = (viewer.user.name ?? '').split(' ');
		await upsertProfile(ctx, viewer.user._id, {
			mainSlug: p.slug,
			...(profile ? {} : { firstName: gFirst, lastName: gRest.join(' ') })
		});
		return null;
	}
});

/** Junak ostane na portalu, samo ni več "tvoj" (npr. ga je prevzel prijatelj). */
export const disown = mutation({
	args: { playerId: v.id('players') },
	handler: async (ctx, { playerId }) => {
		const viewer = await requireViewer(ctx);
		const p = await ownedPlayer(ctx, viewer.user._id, playerId);
		await ctx.db.patch('players', playerId, { ownerUserId: undefined });
		const profile = await profileOf(ctx, viewer.user._id);
		if (profile?.mainSlug === p.slug)
			await ctx.db.patch('profiles', profile._id, { mainSlug: undefined });
		return null;
	}
});

/** Junak izgine s portala skupaj z zgodovino (ni razveljavljivo). */
export const removeCharacter = mutation({
	args: { playerId: v.id('players'), confirmName: v.string() },
	handler: async (ctx, { playerId, confirmName }) => {
		const viewer = await requireViewer(ctx);
		const p = await ownedPlayer(ctx, viewer.user._id, playerId);
		if (clean(confirmName).toLowerCase() !== p.displayName.toLowerCase())
			throw new ConvexError(
				`Type "${p.displayName}" to confirm. We need to be sure you mean murder.`
			);
		const profile = await profileOf(ctx, viewer.user._id);
		if (profile?.mainSlug === p.slug)
			await ctx.db.patch('profiles', profile._id, { mainSlug: undefined });
		await deletePlayer(ctx, playerId);
		return null;
	}
});

/** Prekliči svojo čakajočo peticijo. */
export const cancelPetition = mutation({
	args: { claimId: v.id('claims') },
	handler: async (ctx, { claimId }) => {
		const viewer = await requireViewer(ctx);
		const c = await ctx.db.get('claims', claimId);
		if (!c || c.userId !== viewer.user._id) throw new ConvexError('Not your petition.');
		if (c.status !== 'pending') throw new ConvexError('Already judged. Too late to chicken out.');
		await ctx.db.delete('claims', claimId);
		return null;
	}
});
