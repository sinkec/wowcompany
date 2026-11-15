import { PUBLIC_CONVEX_URL } from '$app/env/public';
import type { RequestHandler } from './$types';

// Discord Interactions Endpoint URL: https://<site>/api/discord/interactions
// SvelteKit samo posreduje surovo zahtevo Convexu, ki preveri podpis in odgovori
// (zasebni podatki nikoli ne gredo skozi javno Convex poizvedbo).
const CONVEX_SITE = PUBLIC_CONVEX_URL.replace(/\.convex\.cloud\/?$/, '.convex.site');

export const POST: RequestHandler = async ({ request }) => {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	for (const h of ['x-signature-ed25519', 'x-signature-timestamp']) {
		const v = request.headers.get(h);
		if (v) headers[h] = v;
	}
	const res = await fetch(`${CONVEX_SITE}/discord/interactions`, {
		method: 'POST',
		headers,
		body: await request.text()
	});
	return new Response(await res.text(), {
		status: res.status,
		headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' }
	});
};
