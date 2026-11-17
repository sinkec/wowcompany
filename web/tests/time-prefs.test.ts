import { expect, test } from 'bun:test';
import { formatHm, formatYmd, prefsOf, validTimeZone } from '../src/convex/lib/timePrefs.ts';

test('date formats', () => {
	expect(formatYmd(2026, 11, 7, 'DD.MM.YYYY')).toBe('07.11.2026');
	expect(formatYmd(2026, 11, 7, 'MM/DD/YYYY')).toBe('11/07/2026');
	expect(formatYmd(2026, 11, 7, 'YYYY-MM-DD')).toBe('2026-11-07');
});
test('time formats', () => {
	expect(formatHm(20, 5, false)).toBe('20:05');
	expect(formatHm(20, 5, true)).toBe('8:05 PM');
	expect(formatHm(0, 0, true)).toBe('12:00 AM');
});
test('prefs fall back to defaults', () => {
	expect(prefsOf(null)).toEqual({ timeZone: null, hour12: false, dateFormat: 'DD.MM.YYYY' });
	expect(prefsOf({ timeZone: 'Mars/Olympus', dateFormat: 'nope' }).timeZone).toBeNull();
	expect(validTimeZone('Europe/Ljubljana')).toBe(true);
});
