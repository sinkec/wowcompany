import { initConvex, encodeConvexLoad, decodeConvexLoad } from 'convex-svelte/sveltekit';
import { PUBLIC_CONVEX_URL } from '$app/env/public';

// Convex singleton na strežniku in v brskalniku (SSR load + žive naročnine).
initConvex(PUBLIC_CONVEX_URL);

export const transport = {
	ConvexLoadResult: {
		encode: encodeConvexLoad,
		decode: decodeConvexLoad
	}
};
