// bun test — Discord vidnost: kar je skrito, ne sme v objavo; vsako vklopljeno polje se mora pokazati.
import { describe, expect, test } from 'bun:test';
import { POST_FIELDS, SAMPLE_PAYLOAD, filterPayload, sessionEmbed } from '../src/convex/lib/discordEmbed.ts';
import { isNewsworthy } from '../src/convex/lib/humor.ts';

const P = SAMPLE_PAYLOAD;
const render = (fields: string[]) => {
	const e = sessionEmbed({ id: 'abc', at: 0, slug: 'testy', payload: filterPayload(P, fields) });
	// besedilo, ki ga človek vidi (brez barve/časa, da števke tam ne motijo)
	const { color: _c, timestamp: _t, ...visible } = e;
	return { e, text: JSON.stringify(visible) };
};

/** Kaj se mora pojaviti, ko je polje vklopljeno (in izginiti, ko je izklopljeno). */
const EXPECT: Record<string, string> = {
	level: '41 → **42**',
	race: 'Undead',
	className: 'Warlock',
	faction: 'Horde',
	guild: '<zadna runda>',
	avatar: '134400.jpg',
	ilvlEquipped: '30 → **33**',
	ilvlAverage: 'Best ilvl',
	achievementPoints: 'Cheevos',
	kills: '1,337',
	deaths: '💀',
	quests: 'Errands',
	honorableKills: 'HKs',
	counters: 'Lost fights with gravity',
	equipment: 'Pants of Questionable Origin',
	professions: 'Tailoring 57 → **63**',
	talents: 'Respec'
};

describe('Discord objava sledi stikalom', () => {
	test('vsako polje iz POST_FIELDS ima pričakovan učinek (razen glavnega stikala in barve)', () => {
		for (const f of POST_FIELDS.filter((x) => !['lastLogin', 'classId'].includes(x))) expect(EXPECT[f]).toBeDefined();
	});

	for (const [field, marker] of Object.entries(EXPECT)) {
		test(`${field}: vklopljeno -> vidno, izklopljeno -> skrito`, () => {
			expect(render(['lastLogin', field]).text).toContain(marker);
			expect(render(POST_FIELDS.filter((f) => f !== field)).text).not.toContain(marker);
		});
	}

	test('classId določa barvo traku', () => {
		expect(render(['classId']).e.color).toBe(0x8788ee);
		expect(render([]).e.color).toBe(0xe5d9b6);
	});

	test('nič vklopljeno -> samo ime, brez številk in plena', () => {
		const { e, text } = render([]);
		expect(e.fields).toEqual([]);
		for (const leak of Object.values(EXPECT)) expect(text).not.toContain(leak);
		expect(e.description).toContain('Testy McTestface');
	});

	test('smrti skrite -> šala ne trdi "didn\'t die once"', () => {
		const p = filterPayload({ ...P, level: { from: 42, to: 42 }, deaths: 0, kills: 500 }, ['kills']);
		expect(sessionEmbed({ id: 'x', at: 0, slug: null, payload: p }).description).not.toContain("didn't die");
	});

	test('vse številke skrite -> ni novica (brez praznih objav)', () => {
		expect(isNewsworthy(filterPayload(P, ['lastLogin', 'race', 'guild']))).toBe(false);
		expect(isNewsworthy(filterPayload(P, ['lastLogin', 'counters']))).toBe(true);
		expect(isNewsworthy(filterPayload(P, ['lastLogin', 'professions']))).toBe(true);
	});

	test('starejši dogodki brez novih polj ne padejo', () => {
		const old = { ...P, race: undefined, counters: undefined, professions: undefined, ilvlAverage: undefined };
		expect(() => sessionEmbed({ id: 'o', at: 0, slug: null, payload: filterPayload(old, POST_FIELDS) })).not.toThrow();
	});
});
