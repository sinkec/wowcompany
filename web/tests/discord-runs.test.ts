import { describe, expect, test } from 'bun:test';
import { parseEmoji, parsesEmbed, runEmbed, type RunPost } from '../src/convex/lib/discordRuns.ts';

const RUN: RunPost = {
	id: 'r1',
	zone: 'Wailing Caverns',
	durationMs: 3_552_000,
	result: { bossesKilled: 6, bossesTotal: 8, wipes: 0, cleared: false },
	leader: 'Fizzle Boom',
	party: [
		{ slug: 'fizzle-boom', name: 'Fizzle Boom', damage: 98_962, healing: 0, deaths: 1 },
		{ slug: 'mendy-bandage', name: 'Mendy Bandage', damage: 18_328, healing: 33_010, deaths: 0 }
	],
	awards: [
		{ title: 'Main Character', slug: 'fizzle-boom', detail: '28 DPS. Everyone else was an NPC.' }
	],
	standings: [{ slug: 'fizzle-boom', avg: 81, best: { encounter: 'Skum', pct: 96 } }],
	dice: [
		{ slug: 'fizzle-boom', avg: 71, wins: 5 },
		{ slug: 'mendy-bandage', avg: 23, wins: 0 }
	]
};
const ALL = ['runs', 'runDetails', 'runDeaths', 'runLoot'];

describe('run post', () => {
	test('nothing without the runs field', () => expect(runEmbed(RUN, [], 'https://x')).toBeNull());
	test('numbers, parses, deaths, dice and the link', () => {
		const e = runEmbed(RUN, ALL, 'https://x') as {
			title: string;
			url: string;
			fields: { name: string; value: string }[];
		};
		expect(e.title).toBe('⚔️ Wailing Caverns — 6/8 bosses, 59:12');
		expect(e.url).toBe('https://x/runs/r1');
		const v = (n: string) => e.fields.find((f) => f.name.startsWith(n))?.value ?? '';
		expect(v('Party')).toContain('**Fizzle Boom** 27.9 dps 🟪 81');
		expect(v('Party')).toContain('9.3 hps'); // the healer shows HPS
		expect(v('Parse of the run')).toContain('🟧 **Fizzle Boom** 96 on Skum');
		expect(v('Deaths')).toBe('Fizzle Boom ☠️×1');
		expect(v('Dice')).toContain('Fizzle Boom (avg 71, 5 won)');
	});
	test('hidden fields stay hidden', () => {
		const e = runEmbed(RUN, ['runs'], 'https://x') as { fields: { name: string }[] };
		expect(e.fields).toHaveLength(0);
	});
});

describe('/parses', () => {
	test('per zone, best percent per boss', () => {
		const e = parsesEmbed(
			{
				name: 'Fizzle Boom',
				slug: 'fizzle-boom',
				season: 'Season 1',
				bestPerfAvg: 81,
				medianPerfAvg: 60,
				encounters: [
					{
						encounter: 'Skum',
						zone: 'Wailing Caverns',
						role: 'dps',
						best: 38.7,
						bestPct: 96,
						kills: 2
					}
				]
			},
			ALL
		) as { description: string; fields: { name: string; value: string }[] };
		expect(e.description).toContain('🟪 **81**');
		expect(e.fields[0]).toEqual({
			name: 'Wailing Caverns',
			value: '🟧 Skum **96** · 38.7 dps · 2 kills'
		});
		expect(
			parsesEmbed(
				{
					...(e as never),
					name: 'x',
					slug: 'x',
					season: 's',
					bestPerfAvg: null,
					medianPerfAvg: null,
					encounters: []
				},
				['runs']
			)
		).toBeNull();
	});
	test('emoji scale', () => {
		expect([100, 99, 95, 75, 50, 25, 3, null].map(parseEmoji).join('')).toBe('🏆💗🟧🟪🟦🟩⬜▫️');
	});
});
