import { describe, expect, test } from 'bun:test';
import { cleanGear, withGameGear } from '../src/convex/lib/gameGear.js';

const NOW = 1_795_700_000_000;
const item = (itemId: number, ilvl: number) => ({
	slot: 'Head',
	slotType: 'HEAD',
	itemId,
	name: `Item ${itemId}`,
	quality: 'RARE',
	ilvl,
	icon: null,
	tooltip: [
		{ text: `Item ${itemId}`, color: null, right: null },
		{ text: 'Binds when equipped', color: null, right: null }
	]
});

describe('cleanGear', () => {
	test('keeps valid slots and items, drops junk', () => {
		const g = cleanGear(
			{
				name: '  Grobos   Stinkfoot ',
				ilvl: 11.75,
				ilvlBest: 12.5,
				at: NOW - 1000,
				items: [
					{ slot: 16, itemId: 2084, ilvl: 33 },
					{ slot: 4, itemId: 6096, ilvl: null },
					{ slot: 99, itemId: 1, ilvl: 1 },
					{ slot: 5, itemId: -3, ilvl: 1 },
					{ slot: 16, itemId: 7, ilvl: 9 },
					{ slot: 1, itemId: 10, ilvl: 5000 }
				]
			},
			NOW
		);
		expect(g).toEqual({
			name: 'Grobos Stinkfoot',
			ilvl: 11.75,
			ilvlBest: 12.5,
			at: NOW - 1000,
			items: [
				{ slot: 1, itemId: 10, ilvl: null },
				{ slot: 4, itemId: 6096, ilvl: null },
				{ slot: 16, itemId: 2084, ilvl: 33 }
			]
		});
	});
	test('nothing worn or no name = nothing', () => {
		expect(cleanGear({ name: 'Grobos', items: [] }, NOW)).toBeNull();
		expect(cleanGear({ items: [{ slot: 1, itemId: 2 }] }, NOW)).toBeNull();
		expect(cleanGear('junk', NOW)).toBeNull();
	});
	test('a time in the future becomes now', () => {
		expect(
			cleanGear({ name: 'Grobos', at: NOW + 86_400_000, items: [{ slot: 1, itemId: 2 }] }, NOW)?.at
		).toBe(NOW);
	});
});

describe('withGameGear', () => {
	const gear = {
		ilvl: 52.6,
		ilvlBest: 54.2,
		at: NOW,
		items: [{ slot: 1, itemId: 22411, ilvl: 63 }]
	};

	test('Blizzard gives no item level: the game fills it in', () => {
		const { summary, details } = withGameGear(
			{ ilvlEquipped: 0, ilvlAverage: 0 },
			{ equipment: [item(22411, 0), item(13177, 0)] },
			gear
		);
		expect(summary).toEqual({ ilvlEquipped: 52, ilvlAverage: 54 });
		const eq = details.equipment as ReturnType<typeof item>[];
		expect(eq[0].ilvl).toBe(63);
		expect(eq[0].tooltip[1]).toEqual({ text: 'Item Level 63', color: '#ffd100', right: null });
		expect(eq[1].ilvl).toBe(0); // the game did not say
	});

	test("Blizzard's numbers win when it has them", () => {
		const s = { ilvlEquipped: 13, ilvlAverage: 13 };
		const d = { equipment: [item(22411, 20)] };
		const r = withGameGear(s, d, gear);
		expect(r.summary).toBe(s);
		expect(r.details).toBe(d);
	});

	test('no gear from the game: unchanged', () => {
		const s = { ilvlEquipped: 0, ilvlAverage: 0 };
		const d = { equipment: [] };
		expect(withGameGear(s, d, null)).toEqual({ summary: s, details: d });
	});
});
