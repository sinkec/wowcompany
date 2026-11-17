import { describe, expect, test } from 'bun:test';
import {
	cleanCompanyEvent,
	cleanGameEvents,
	eventEmbed,
	eventsListEmbed,
	gameKey,
	overlaps
} from '../src/convex/lib/calendar.ts';
import { brandName, cleanTeamName } from '../src/convex/lib/siteContent.ts';

const H = 3_600_000;
const base = { description: '', kind: 'dungeon', startAt: 10 * H, endAt: 12 * H };

describe('cleanCompanyEvent', () => {
	test('trims and accepts', () => {
		const r = cleanCompanyEvent({ ...base, title: '  Deadmines   run ', location: ' Westfall ' });
		expect(r.ok && r.event.title).toBe('Deadmines run');
		expect(r.ok && r.event.location).toBe('Westfall');
	});
	test('rejects bad input', () => {
		expect(cleanCompanyEvent({ ...base, title: 'x' }).ok).toBe(false);
		expect(cleanCompanyEvent({ ...base, title: 'Run', kind: 'nope' }).ok).toBe(false);
		expect(cleanCompanyEvent({ ...base, title: 'Run', endAt: 9 * H }).ok).toBe(false);
		expect(cleanCompanyEvent({ ...base, title: 'Run', endAt: 10 * H + 15 * 24 * H }).ok).toBe(
			false
		);
	});
});

describe('cleanGameEvents', () => {
	test('keeps holidays only, dedupes by title and hour', () => {
		const out = cleanGameEvents([
			{
				title: 'Darkmoon Faire',
				description: 'Fun',
				kind: 'holiday',
				startAt: 100 * H,
				endAt: 200 * H
			},
			{
				title: 'Darkmoon Faire',
				description: 'Fun',
				kind: 'holiday',
				startAt: 100 * H + 60_000,
				endAt: 200 * H
			},
			{
				title: 'Guild raid',
				description: 'secret',
				kind: 'player',
				startAt: 100 * H,
				endAt: 101 * H
			},
			{ title: '', description: '', kind: 'holiday', startAt: 100 * H, endAt: 101 * H }
		]);
		expect(out.map((e) => e.title)).toEqual(['Darkmoon Faire']);
		expect(out[0].key).toBe(gameKey('Darkmoon Faire', 100 * H));
	});
	test('end before start becomes a point in time', () => {
		const [e] = cleanGameEvents([
			{ title: 'Reset', description: '', kind: 'system', startAt: 5 * H, endAt: 1 }
		]);
		expect(e.endAt).toBe(5 * H);
	});
});

test('overlaps', () => {
	expect(overlaps({ startAt: 0, endAt: 10 }, 5, 20)).toBe(true);
	expect(overlaps({ startAt: 0, endAt: 4 }, 5, 20)).toBe(false);
	expect(overlaps({ startAt: 20, endAt: 30 }, 5, 20)).toBe(false);
});

test('embeds use the brand and Discord timestamps', () => {
	const e = {
		id: 'x',
		source: 'company' as const,
		title: 'RFC',
		...base,
		going: [{ name: 'Ajmer' }]
	};
	const one = eventEmbed(e, 'new', 'Ajmer Central WowCompany', 'https://site');
	expect(one.footer.text).toContain('Ajmer Central WowCompany');
	expect(one.url).toBe('https://site/calendar?event=x');
	expect(JSON.stringify(one.fields)).toContain('<t:36000:F>');
	const list = eventsListEmbed([e], 'WowCompany');
	expect(list.description).toContain('Our events');
	expect(eventsListEmbed([], 'WowCompany').description).toContain('Nothing planned');
});

test('team name', () => {
	expect(cleanTeamName('  Ajmer   Central Wow Company ')).toBe('Ajmer Central');
	expect(brandName('Ajmer Central')).toBe('Ajmer Central WowCompany');
	expect(brandName('')).toBe('WowCompany');
});
