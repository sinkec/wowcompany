// bun test — poller piše samo ob dejanski spremembi.
import { describe, expect, test } from 'bun:test';
import { sameFields, stableStringify } from '../src/convex/lib/same.ts';

describe('stableStringify', () => {
	test('key order does not matter, undefined is dropped', () => {
		expect(stableStringify({ b: 1, a: { d: [1, 2], c: 'x' }, u: undefined })).toBe(
			stableStringify({ a: { c: 'x', d: [1, 2] }, b: 1 })
		);
	});
	test('array order matters', () => {
		expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
	});
});

describe('sameFields', () => {
	const keys = ['level', 'counters', 'guild'];
	test('ignores _id, updatedAt and other non-listed fields', () => {
		const prev = { _id: 'x', updatedAt: 1, level: 10, counters: { a: 1, b: 2 }, guild: undefined };
		expect(sameFields(prev, { level: 10, counters: { b: 2, a: 1 } }, keys)).toBe(true);
	});
	test('detects changes, including a field that disappears', () => {
		expect(sameFields({ level: 10, guild: 'G' }, { level: 10 }, keys)).toBe(false);
		expect(sameFields({ level: 10 }, { level: 11 }, keys)).toBe(false);
		expect(sameFields(null, { level: 10 }, keys)).toBe(false);
	});
});
