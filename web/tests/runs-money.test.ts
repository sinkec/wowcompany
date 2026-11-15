import { describe, expect, test } from 'bun:test';
import { fmtMoney } from '../src/lib/runs.ts';

describe('money', () => {
	test('gold, silver, copper without zeros', () => {
		expect(fmtMoney(10_203)).toBe('1g 2s 3c');
		expect(fmtMoney(1605)).toBe('16s 5c');
		expect(fmtMoney(20_000)).toBe('2g');
		expect(fmtMoney(0)).toBe('0c');
	});
});
