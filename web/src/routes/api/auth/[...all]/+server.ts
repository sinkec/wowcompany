import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';

// Better Auth zahteve gredo prek SvelteKita na Convex HTTP akcije.
export const { GET, POST } = createSvelteKitHandler();
