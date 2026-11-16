import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_CONVOS,
	DEFAULT_QUIPS,
	MAX_LINE,
	cleanSocials,
	fillLine,
	parseConvos,
	parseQuips
} from '../src/convex/lib/siteContent.ts';

describe('hero lines', () => {
	test('one per line, trimmed, no blanks or duplicates', () => {
		expect(parseQuips(' Pulls first. \n\nPulls first.\n  I tank with my face  ')).toEqual([
			'Pulls first.',
			'I tank with my face'
		]);
		expect(parseQuips('x'.repeat(500))[0]).toHaveLength(MAX_LINE);
	});
	test('conversations are blocks of exactly three', () => {
		expect(parseConvos('Who pulled?\nNot me.\nThe bear.\n\nReady?\nNo.\nGo!')).toEqual({
			convos: [
				['Who pulled?', 'Not me.', 'The bear.'],
				['Ready?', 'No.', 'Go!']
			],
			error: null
		});
		expect(parseConvos('One\nTwo').error).toContain('exactly 3');
	});
	test('placeholders: speaker and speakers by order', () => {
		const names = ['Amadej', 'Kacha', 'Baksuz'];
		expect(fillLine('Nice crit, {2}!', 0, names)).toBe('Nice crit, Kacha!');
		expect(fillLine("I'm {me}.", 2, names)).toBe("I'm Baksuz.");
	});
	test('built-in jokes fit the rules', () => {
		expect(DEFAULT_QUIPS.every((q) => q.length <= MAX_LINE)).toBe(true);
		expect(DEFAULT_CONVOS.every((c) => c.length === 3)).toBe(true);
	});
});

describe('community links', () => {
	test('known kinds and https only', () => {
		expect(
			cleanSocials([
				{ kind: 'discord', url: ' https://discord.gg/abc ' },
				{ kind: 'facebook', url: 'http://facebook.com/x' },
				{ kind: 'myspace', url: 'https://myspace.com' },
				{ kind: 'website', url: 'https://example.com', label: '  Our blog ' }
			])
		).toEqual([
			{ kind: 'discord', url: 'https://discord.gg/abc' },
			{ kind: 'website', url: 'https://example.com', label: 'Our blog' }
		]);
	});
});
