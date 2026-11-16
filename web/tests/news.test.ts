import { describe, expect, test } from 'bun:test';
import { parseBlizzardNews } from '../src/convex/lib/news.ts';

const blog = (id: string, title: string, published: string, extra: Record<string, unknown> = {}) => ({
	title,
	id,
	url: `/news/${id}/some-slug`,
	description: `<p>About ${title}</p>  more`,
	content: '<p>long text with } and { inside</p>',
	published,
	thumbnail: { url: `//bnetcmsus-a.akamaihd.net/cms/${id}.png` },
	...extra
});
const page = (blogs: unknown[]) =>
	`<html><script id="model">model = ${JSON.stringify({ masthead: {}, blogList: { blogs, page: 1, total: 9 } })};</script>`;

describe('blizzard news page', () => {
	test('articles from the embedded model, newest first', () => {
		const items = parseBlizzardNews(
			page([
				blog('1', 'Old news', '2026-11-01T10:00:00.000Z'),
				blog('2', 'WoW: Forever Hotfixes', '2026-11-13T18:00:00.000Z')
			])
		);
		expect(items.map((i) => i.key)).toEqual(['bz:2', 'bz:1']);
		expect(items[0]).toEqual({
			key: 'bz:2',
			title: 'WoW: Forever Hotfixes',
			summary: 'About WoW: Forever Hotfixes more',
			url: 'https://worldofwarcraft.blizzard.com/en-gb/news/2/some-slug',
			image: 'https://bnetcmsus-a.akamaihd.net/cms/2.png',
			publishedAt: Date.parse('2026-11-13T18:00:00.000Z')
		});
	});
	test('broken entries and foreign links are skipped, no model = nothing', () => {
		const items = parseBlizzardNews(
			page([
				blog('3', 'Evil', '2026-11-01T10:00:00.000Z', { url: 'https://evil.example/x' }),
				blog('4', '', '2026-11-01T10:00:00.000Z'),
				blog('5', 'No date', 'whenever')
			])
		);
		expect(items).toEqual([]);
		expect(parseBlizzardNews('<html>nothing</html>')).toEqual([]);
	});
});
