import { describe, expect, test } from 'bun:test';
import { baseName, exactHit } from '../src/convex/lib/items.ts';

describe('item names', () => {
	test('random suffix off, real names untouched', () => {
		expect(baseName('Gleaming Claymore of the Wolf')).toBe('Gleaming Claymore');
		expect(baseName("Outrunner's Cloak of Power")).toBe("Outrunner's Cloak");
		expect(baseName('Barbed Club of Shadow Protection')).toBe('Barbed Club');
		expect(baseName('Linen Cloth')).toBeNull();
		expect(baseName('Cloak of Hermitic Bliss')).toBeNull(); // two words after "of": a real item name
	});
	test('only an exact name counts', () => {
		const results = [
			{ data: { id: 10441, name: { en_GB: 'Glowing Shard' }, quality: { type: 'COMMON' } } },
			{
				data: { id: 6449, name: { en_GB: 'Glowing Lizardscale Cloak' }, quality: { type: 'RARE' } }
			}
		];
		expect(exactHit(results, 'Glowing Lizardscale Cloak')).toEqual({ itemId: 6449, quality: 3 });
		expect(exactHit(results, 'Glowing')).toBeNull();
	});
});
