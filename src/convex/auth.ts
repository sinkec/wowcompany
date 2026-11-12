import { createClient, type AuthFunctions, type CreateAuth } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { components, internal } from './_generated/api.js';
import { type DataModel } from './_generated/dataModel.js';
import { query } from './_generated/server.js';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import authConfig from './auth.config.js';
import { getViewer } from './lib/access.js';

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
	authFunctions,
	triggers: {
		user: {
			// Namestitev platforme: prvi uporabnik postane admin.
			// Mutacija je atomarna -> ne moreta dva hkrati postati admin.
			onCreate: async (ctx, user) => {
				const existingAdmin = await ctx.db
					.query('roles')
					.withIndex('by_role', (q) => q.eq('role', 'admin'))
					.first();
				if (existingAdmin) return;
				await ctx.db.insert('roles', {
					userId: user._id,
					email: user.email,
					name: user.name ?? undefined,
					role: 'admin',
					createdAt: Date.now()
				});
			}
		}
	}
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth: CreateAuth<DataModel> = (ctx) => {
	const options: BetterAuthOptions = {
		baseURL: process.env.SITE_URL!,
		database: authComponent.adapter(ctx),
		// samo Google prijava (brez gesel)
		socialProviders: {
			google: {
				clientId: process.env.GOOGLE_CLIENT_ID as string,
				clientSecret: process.env.GOOGLE_CLIENT_SECRET as string
			}
		},
		plugins: [convex({ authConfig, jwksRotateOnTokenGenerationError: true })]
	};
	return betterAuth(options);
};

/** Trenutni uporabnik + vloga ('admin' | 'member' | null). */
export const me = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await getViewer(ctx);
		if (!viewer) return null;
		return {
			id: viewer.user._id,
			name: viewer.user.name,
			email: viewer.user.email,
			image: viewer.user.image ?? null,
			role: viewer.role
		};
	}
});
