import { describe, expect, test } from 'bun:test';
import { DAY, daysLeft, realmKey, realmLabel, rulesetMatches, validRealm } from '../src/convex/lib/realms.ts';

describe('realms', () => {
	test('key and label', () => {
		expect(realmKey({ region: 'eu', ruleset: 'PvP' })).toBe('eu-pvp');
		expect(realmLabel({ region: 'us', ruleset: 'Normal' })).toBe('US · Normal');
	});
	test('only known regions and rulesets', () => {
		expect(validRealm({ region: 'eu', ruleset: 'PvP' })).toBe(true);
		expect(validRealm({ region: 'kr', ruleset: 'PvP' })).toBe(false);
		expect(validRealm({ region: 'eu', ruleset: 'Hardcore' })).toBe(false);
	});
	test('a hero fits the company realm by ruleset (PvE = Normal; unknown passes)', () => {
		const eu = { region: 'eu', ruleset: 'Normal' };
		expect(rulesetMatches('PvE', eu)).toBe(true);
		expect(rulesetMatches('normal', eu)).toBe(true);
		expect(rulesetMatches('PvP', eu)).toBe(false);
		expect(rulesetMatches(null, eu)).toBe(true);
		expect(rulesetMatches('PvP', undefined)).toBe(true);
	});
	test('days left round up and never go negative', () => {
		expect(daysLeft(30 * DAY, 0)).toBe(30);
		expect(daysLeft(DAY + 1, 0)).toBe(2);
		expect(daysLeft(0, DAY)).toBe(0);
	});
});
