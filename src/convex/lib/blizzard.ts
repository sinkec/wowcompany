// Battle.net klient za WoW Forever (client credentials). Teče v Convex akcijah (fetch).

const env = (k: string, d?: string) => {
	const v = process.env[k] ?? d;
	if (!v) throw new Error(`Manjka Convex env ${k}`);
	return v;
};

const region = () => env('BLIZZARD_REGION', 'eu');
const locale = () => env('BLIZZARD_LOCALE', 'en_GB');
export const profileNs = () => env('BLIZZARD_PROFILE_NAMESPACE', `profile-forever-${region()}`);
export const staticNs = () => env('BLIZZARD_STATIC_NAMESPACE', `static-forever-${region()}`);

// Token velja ~24 h. Hranimo ga v pomnilniku izolata (Convex ga pogosto ponovno uporabi);
// če izolat ni topel, se pridobi nov – en dodaten klic, brez DB I/O.
let cached: { token: string; exp: number } | null = null;

export async function getToken(force = false): Promise<string> {
	if (!force && cached && Date.now() < cached.exp) return cached.token;
	const basic = btoa(`${env('BLIZZARD_CLIENT_ID')}:${env('BLIZZARD_CLIENT_SECRET')}`);
	const res = await fetch('https://oauth.battle.net/token', {
		method: 'POST',
		headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: 'grant_type=client_credentials'
	});
	if (!res.ok) throw new Error(`Blizzard token: ${res.status} ${await res.text()}`);
	const body = (await res.json()) as { access_token: string; expires_in: number };
	cached = { token: body.access_token, exp: Date.now() + (body.expires_in - 300) * 1000 };
	return cached.token;
}

export type GetResult =
	| { status: 200; body: any; lastModified?: string }
	| { status: 304 }
	| { status: 404 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET z If-Modified-Since, ponovnim poskusom ob 429/5xx in osvežitvijo tokena ob 401. */
export async function get(path: string[], ns: string, ifModifiedSince?: string): Promise<GetResult> {
	const url = new URL(`https://${region()}.api.blizzard.com/`);
	url.pathname = '/' + path.map(encodeURIComponent).join('/');
	url.searchParams.set('namespace', ns);
	url.searchParams.set('locale', locale());

	let forceToken = false;
	for (let attempt = 0; attempt < 4; attempt++) {
		const headers: Record<string, string> = { Authorization: `Bearer ${await getToken(forceToken)}` };
		if (ifModifiedSince) headers['If-Modified-Since'] = ifModifiedSince;
		const res = await fetch(url, { headers });
		if (res.status === 200) {
			return { status: 200, body: await res.json(), lastModified: res.headers.get('last-modified') ?? undefined };
		}
		if (res.status === 304) return { status: 304 };
		if (res.status === 404) return { status: 404 };
		if (res.status === 401 && !forceToken) {
			forceToken = true;
			continue;
		}
		if (res.status === 429 || res.status >= 500) {
			await sleep(500 * 2 ** attempt);
			continue;
		}
		throw new Error(`Blizzard ${url.pathname} -> ${res.status}`);
	}
	throw new Error(`Blizzard ${url.pathname}: preveč neuspešnih poskusov`);
}

export type RawCharacter = {
	profile: any;
	equipment?: any;
	statistics?: any;
	media?: any;
	professions?: any;
	pvp?: any;
	achievementStats?: any;
};

const SUBS = [
	['equipment', 'equipment'],
	['statistics', 'statistics'],
	['media', 'character-media'],
	['professions', 'professions'],
	['pvp', 'pvp-summary'],
	['achievementStats', 'achievements/statistics']
] as const;

/** Pod-endpointi lika (vzporedno). Napake posameznih se ignorirajo – Forever API je nepopoln. */
export async function getCharacterParts(slug: string, profile: any): Promise<RawCharacter> {
	const raw: RawCharacter = { profile };
	await Promise.all(
		SUBS.map(async ([key, sub]) => {
			try {
				const r = await get(['profile', 'wow', 'character', slug, ...sub.split('/')], profileNs());
				if (r.status === 200) raw[key] = r.body;
			} catch {
				/* manjkajoč del ni usoden */
			}
		})
	);
	return raw;
}

export async function itemIcon(itemId: number): Promise<string | null> {
	const r = await get(['data', 'wow', 'media', 'item', String(itemId)], staticNs());
	if (r.status !== 200) return null;
	const a = (r.body.assets ?? []).find((x: any) => x.key === 'icon');
	return a?.value ?? null;
}

/** Izvede `fn` nad elementi z omejeno sočasnostjo. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let i = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (i < items.length) {
			const idx = i++;
			out[idx] = await fn(items[idx]);
		}
	});
	await Promise.all(workers);
	return out;
}

/** "Sinek Helgater" -> "sinek-helgater" */
export const slugify = (name: string) => name.trim().toLowerCase().split(/\s+/).filter(Boolean).join('-');
