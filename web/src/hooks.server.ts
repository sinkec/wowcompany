import type { Handle } from '@sveltejs/kit/hooks';
import { sequence } from '@sveltejs/kit/hooks';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { withServerConvexToken } from 'convex-svelte/sveltekit/server';
import { convexLoadHydration } from 'convex-svelte/sveltekit/server/hydration';

// Token prijave iz piškotkov -> Convex strežniški odjemalec (SSR pozna uporabnika).
const convexAuth: Handle = async ({ event, resolve }) => {
	const token = getToken(event.cookies);
	event.locals.token = token;
	return withServerConvexToken(token, () => resolve(event));
};

export const handle = sequence(convexAuth, convexLoadHydration);
