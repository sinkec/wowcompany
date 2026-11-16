// Novice: uradna stran WoW novic (worldofwarcraft.blizzard.com/en-gb/news) ima v <script id="model">
// vgrajen JSON `model = {…}` s seznamom člankov (`blogList.blogs`: naslov, opis, slika, povezava,
// čas objave – tudi hotfixi za Forever). Vzamemo samo to; slike ostanejo na Blizzardovem CDN-ju.
// Čista logika brez baze – testi v tests/news.test.ts.

export type NewsItem = {
	key: string;
	title: string;
	summary: string;
	url: string;
	image: string | null;
	publishedAt: number;
};

export const NEWS_SITE = 'https://worldofwarcraft.blizzard.com';
export const NEWS_PAGE = `${NEWS_SITE}/en-gb/news`;

/** JSON objekt, ki se začne pri `{` na indeksu `start` (upošteva nize in ubežne znake). */
function objectAt(text: string, start: number): string | null {
	let depth = 0;
	let inStr = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (inStr) {
			if (c === '\\') i++;
			else if (c === '"') inStr = false;
		} else if (c === '"') inStr = true;
		else if (c === '{') depth++;
		else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
	}
	return null;
}

const clean = (s: unknown, max: number) =>
	typeof s === 'string'
		? s
				.replace(/<[^>]*>/g, ' ')
				.replace(/&nbsp;/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
				.slice(0, max)
		: '';

const https = (u: unknown): string | null => {
	if (typeof u !== 'string') return null;
	const full = u.startsWith('//') ? `https:${u}` : u;
	return /^https:\/\/[a-z0-9.-]+\//i.test(full) ? full : null;
};

type Blog = {
	id?: unknown;
	title?: unknown;
	description?: unknown;
	url?: unknown;
	published?: unknown;
	thumbnail?: { url?: unknown } | null;
	image?: { url?: unknown } | null;
};

export function parseBlizzardNews(html: string, max = 20): NewsItem[] {
	const at = html.indexOf('model = {');
	if (at < 0) return [];
	const raw = objectAt(html, at + 8);
	if (!raw) return [];
	let model: { blogList?: { blogs?: Blog[] } };
	try {
		model = JSON.parse(raw);
	} catch {
		return [];
	}
	const out = new Map<string, NewsItem>();
	for (const b of model.blogList?.blogs ?? []) {
		const id = typeof b.id === 'string' || typeof b.id === 'number' ? String(b.id) : null;
		const title = clean(b.title, 140);
		const publishedAt = typeof b.published === 'string' ? Date.parse(b.published) : NaN;
		const path = typeof b.url === 'string' && b.url.startsWith('/news/') ? b.url : null;
		if (!id || !title || !path || !Number.isFinite(publishedAt)) continue;
		out.set(`bz:${id}`, {
			key: `bz:${id}`,
			title,
			summary: clean(b.description, 400),
			url: `${NEWS_SITE}/en-gb${path}`,
			image: https(b.thumbnail?.url) ?? https(b.image?.url),
			publishedAt
		});
		if (out.size >= max) break;
	}
	return [...out.values()].sort((a, b) => b.publishedAt - a.publishedAt);
}
