// HTTP vstopne točke za namizno aplikacijo (kličejo se neposredno na *.convex.site, ne prek Vercela).
//   POST /companion/link/start  {deviceName, appVersion?}  -> {code, pollToken, linkUrl, expiresAt}
//   POST /companion/link/poll   {pollToken}                -> {status, token?}
//   POST /companion/runs        Authorization: Bearer <token>, telo = RunSummary (schema 1)
// Žetoni in poll skrivnosti nastanejo tu (akcije smejo uporabljati naključnost) in se v bazo
// zapišejo samo kot SHA-256.
import { ConvexError } from 'convex/values';
import { internal } from './_generated/api.js';
import { httpAction } from './_generated/server.js';
import { makeLinkCode, MAX_BODY_BYTES } from './lib/companion.js';
import { SCHEMA_VERSION, SUPPORTED_SCHEMAS } from './lib/companionSchema.js';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...extra }
	});

function randomBytes(n: number): Uint8Array {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return b;
}

function base64url(b: Uint8Array): string {
	let s = '';
	for (const x of b) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256hex(text: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function rand32(): number {
	return new DataView(randomBytes(4).buffer).getUint32(0);
}

/** Prebere JSON telo z omejitvijo velikosti; vrne `unknown` ali Response z napako. */
async function readJson(req: Request, limit: number): Promise<unknown | Response> {
	const len = Number(req.headers.get('content-length') ?? '0');
	if (len > limit) return json({ error: 'payload too large' }, 413);
	const text = await req.text();
	if (text.length > limit) return json({ error: 'payload too large' }, 413);
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return json({ error: 'invalid JSON' }, 400);
	}
}

const isObj = (x: unknown): x is Record<string, unknown> =>
	typeof x === 'object' && x !== null && !Array.isArray(x);

/** ConvexError iz mutacije -> HTTP odgovor. */
function errorResponse(e: unknown): Response {
	if (e instanceof ConvexError && isObj(e.data)) {
		const { code, message, retryAfter } = e.data as {
			code: string;
			message: string;
			retryAfter: number | null;
		};
		const status =
			{ bad_request: 400, unauthorized: 401, forbidden: 403, rate_limited: 429, retry: 503 }[
				code
			] ?? 500;
		const headers: Record<string, string> = retryAfter
			? { 'Retry-After': String(Math.ceil(retryAfter / 1000)) }
			: {};
		return json({ error: message, code }, status, headers);
	}
	const msg = e instanceof Error ? e.message : String(e);
	if (msg.includes('ArgumentValidationError') || msg.includes('Validator')) {
		return json(
			{ error: 'summary does not match schema', code: 'bad_request', schema: SCHEMA_VERSION },
			400
		);
	}
	console.error('companion http error', msg);
	return json({ error: 'server error' }, 500);
}

export const linkStart = httpAction(async (ctx, req) => {
	const body = await readJson(req, 4096);
	if (body instanceof Response) return body;
	if (!isObj(body) || typeof body.deviceName !== 'string' || body.deviceName.trim().length < 1)
		return json({ error: 'deviceName required' }, 400);
	const appVersion = typeof body.appVersion === 'string' ? body.appVersion : undefined;

	const pollToken = base64url(randomBytes(32));
	const pollHash = await sha256hex(pollToken);
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = makeLinkCode(rand32);
		try {
			const { expiresAt } = await ctx.runMutation(internal.companion.startLink, {
				code,
				pollHash,
				deviceName: body.deviceName.trim(),
				appVersion
			});
			const site = process.env.SITE_URL ?? '';
			return json({
				code,
				pollToken,
				expiresAt,
				linkUrl: `${site}/link?code=${encodeURIComponent(code)}`
			});
		} catch (e) {
			if (e instanceof ConvexError && isObj(e.data) && e.data.code === 'retry') continue;
			return errorResponse(e);
		}
	}
	return json({ error: 'could not allocate a code, try again' }, 503);
});

export const linkPoll = httpAction(async (ctx, req) => {
	const body = await readJson(req, 1024);
	if (body instanceof Response) return body;
	if (!isObj(body) || typeof body.pollToken !== 'string' || body.pollToken.length < 20)
		return json({ error: 'pollToken required' }, 400);

	// Žeton pripravimo vnaprej; vrnemo ga samo, če je povezava ravno odobrena.
	const token = `wcc_${base64url(randomBytes(32))}`;
	try {
		const r = await ctx.runMutation(internal.companion.pollLink, {
			pollHash: await sha256hex(body.pollToken),
			tokenHash: await sha256hex(token)
		});
		if (r.status === 'approved') return json({ status: 'approved', token, deviceId: r.deviceId });
		return json(r);
	} catch (e) {
		return errorResponse(e);
	}
});

export const uploadRun = httpAction(async (ctx, req) => {
	const auth = req.headers.get('authorization') ?? '';
	const m = /^Bearer (wcc_[A-Za-z0-9_-]{20,})$/.exec(auth);
	if (!m) return json({ error: 'missing or malformed device token', code: 'unauthorized' }, 401);

	const body = await readJson(req, MAX_BODY_BYTES);
	if (body instanceof Response) return body;
	if (!isObj(body)) return json({ error: 'body must be an object' }, 400);
	if (typeof body.schema !== 'number' || !SUPPORTED_SCHEMAS.includes(body.schema))
		return json(
			{
				error: `unsupported schema ${String(body.schema)}, server speaks ${SCHEMA_VERSION}`,
				code: 'schema'
			},
			400
		);

	try {
		const r = await ctx.runMutation(internal.companion.ingestRun, {
			tokenHash: await sha256hex(m[1]),
			// Obliko preveri validator argumentov (runSummary); napaka -> 400.
			summary: body as never
		});
		const site = process.env.SITE_URL ?? '';
		return json({ ...r, url: `${site}/runs/${r.runId}` }, r.created ? 201 : 200);
	} catch (e) {
		return errorResponse(e);
	}
});
