import { httpRouter } from 'convex/server';
import nacl from 'tweetnacl';
import { internal } from './_generated/api.js';
import { httpAction } from './_generated/server.js';
import { authComponent, createAuth } from './auth.js';
import { linkPoll, linkStart, uploadRun } from './companionHttp.js';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

const hex = (h: string) => new Uint8Array((h.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Ed25519 preverba Discordovega podpisa: timestamp + surovo telo. */
function verifyDiscord(
	key: string | null,
	body: string,
	signature: string | null,
	timestamp: string | null
): boolean {
	if (!key || !signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature)) return false;
	try {
		return nacl.sign.detached.verify(
			new TextEncoder().encode(timestamp + body),
			hex(signature),
			hex(key)
		);
	} catch {
		return false;
	}
}

type Option = { name: string; value?: unknown; focused?: boolean; options?: Option[] };
const flatten = (opts: Option[] = []): Record<string, string> =>
	Object.fromEntries(
		opts.filter((o) => o.value !== undefined).map((o) => [o.name, String(o.value)])
	);

// Discord Interactions Endpoint (SvelteKit /api/discord/interactions posreduje sem).
http.route({
	path: '/discord/interactions',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		const body = await req.text();
		const cfg = await ctx.runQuery(internal.integrations.config, {});
		if (
			!verifyDiscord(
				cfg.publicKey,
				body,
				req.headers.get('x-signature-ed25519'),
				req.headers.get('x-signature-timestamp')
			)
		)
			return new Response('invalid request signature', { status: 401 });

		const i = JSON.parse(body) as { type: number; data?: { name: string; options?: Option[] } };
		if (i.type === 1) return json({ type: 1 }); // PING -> PONG

		if (i.type === 4 && i.data) {
			// autocomplete za /hero name
			const focused = (i.data.options ?? []).find((o) => o.focused);
			const choices = await ctx.runQuery(internal.bot.autocomplete, {
				q: String(focused?.value ?? '')
			});
			return json({ type: 8, data: { choices } });
		}

		if (i.type === 2 && i.data) {
			const res = await ctx.runQuery(internal.bot.respond, {
				command: i.data.name,
				options: flatten(i.data.options)
			});
			return json(res);
		}

		return json({ type: 4, data: { content: 'Unsupported interaction.', flags: 64 } });
	})
});

// WowCompany Companion (namizna aplikacija) – COMPANION.md §7–8.
http.route({ path: '/companion/link/start', method: 'POST', handler: linkStart });
http.route({ path: '/companion/link/poll', method: 'POST', handler: linkPoll });
http.route({ path: '/companion/runs', method: 'POST', handler: uploadRun });

export default http;
