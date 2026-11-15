// Kdo gleda in kaj sme videti. Vse filtriranje javno/zasebno gre skozi te funkcije (strežniško).
import type { QueryCtx } from '../_generated/server.js';
import { authComponent } from '../auth.js';

export type Role = 'admin' | 'member';

export async function getViewer(ctx: QueryCtx) {
	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) return null;
	const roleDoc = await ctx.db
		.query('roles')
		.withIndex('by_user', (q) => q.eq('userId', user._id))
		.unique();
	return { user, role: (roleDoc?.role ?? null) as Role | null };
}

/** Admin in člani vidijo zasebne podatke vseh igralcev. */
export async function canSeePrivate(ctx: QueryCtx) {
	const viewer = await getViewer(ctx);
	return viewer?.role === 'admin' || viewer?.role === 'member';
}

export async function requireAdmin(ctx: QueryCtx) {
	const viewer = await getViewer(ctx);
	if (viewer?.role !== 'admin') throw new Error('Guild Master only.');
	return viewer;
}
