// Profil uporabnika (ime/priimek, glavni junak) – brez ctx odvisnosti od auth.ts (ni krožnih uvozov).
import type { Doc } from '../_generated/dataModel.js';
import type { QueryCtx } from '../_generated/server.js';

export async function profileOf(ctx: QueryCtx, userId: string) {
	return ctx.db
		.query('profiles')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.unique();
}

/** Ime za prikaz: profil > Google ime > e-pošta. */
export function displayNameOf(profile: Doc<'profiles'> | null, fallback: string) {
	const full = profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
	return full || fallback;
}
