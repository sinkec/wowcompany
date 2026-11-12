import { defineEnvVars } from '@sveltejs/kit/env';

// SvelteKit 3 izpostavi samo deklarirane spremenljivke.
export const variables = defineEnvVars({
	PUBLIC_CONVEX_URL: { public: true, static: true }
});
