import { describe, expect, test } from 'bun:test';
import {
	heroLogs,
	parseRows,
	patchFromNamespace,
	patchLine,
	poolKey,
	roleOf,
	standing
} from '../src/convex/lib/parses.ts';
import type { RunSummary } from '../src/convex/lib/companionSchema.ts';

const SP = (slug: string, damage: number, healing: number, damageTaken: number, ilvl?: number) => ({
	slug,
	damage,
	healing,
	damageTaken,
	...(ilvl ? { ilvl } : {})
});

const RUN = (segments: RunSummary['segments']): RunSummary => ({
	schema: 4,
	runKey: '0123456789abcdef',
	zone: { instanceId: 43, name: 'Wailing Caverns', difficultyId: 1, instanceUid: 27750 },
	startedAt: 1_000_000,
	endedAt: 4_000_000,
	durationMs: 3_000_000,
	endReason: 'leftInstance',
	result: { bossesKilled: 1, bossesTotal: 8, wipes: 0, cleared: false },
	recorder: 'grobos-stinkfoot',
	players: [],
	segments,
	deaths: [],
	timeline: { bucketMs: 10_000, players: [] }
});

describe('roles', () => {
	test('healer, tank, dps', () => {
		expect(roleOf({ damage: 100, healing: 900, damageTaken: 50 }, 1000, 5)).toBe('heal');
		expect(roleOf({ damage: 300, healing: 0, damageTaken: 600 }, 1000, 5)).toBe('tank');
		expect(roleOf({ damage: 900, healing: 0, damageTaken: 100 }, 1000, 5)).toBe('dps');
		// two players: no tank, the one who got hit is just unlucky
		expect(roleOf({ damage: 300, healing: 0, damageTaken: 900 }, 1000, 2)).toBe('dps');
	});
});

describe('parse rows', () => {
	test('only killed bosses, only tracked heroes, per second of the fight', () => {
		const rows = parseRows(
			RUN([
				{
					kind: 'trash',
					name: 'Trash',
					encounterId: null,
					startMs: 0,
					endMs: 60_000,
					result: 'none',
					players: [SP('fizzle-boom', 9999, 0, 0)]
				},
				{
					kind: 'boss',
					name: 'Kresh',
					encounterId: 587,
					startMs: 100_000,
					endMs: 120_000,
					result: 'wipe',
					players: [SP('fizzle-boom', 500, 0, 0)]
				},
				{
					kind: 'boss',
					name: 'Skum',
					encounterId: 589,
					startMs: 200_000,
					endMs: 230_000,
					result: 'kill',
					players: [
						SP('fizzle-boom', 3000, 0, 100, 18),
						SP('mendy-bandage', 30, 2400, 50),
						SP('random-stranger', 9000, 0, 900)
					]
				}
			]),
			new Set(['fizzle-boom', 'mendy-bandage'])
		);
		expect(rows.map((r) => [r.slug, r.encounter, r.role, r.dps, r.hps, r.ilvl])).toEqual([
			['fizzle-boom', 'Skum', 'dps', 100, 0, 18],
			['mendy-bandage', 'Skum', 'heal', 1, 80, null]
		]);
		expect(rows[0].at).toBe(1_000_000 + 230_000);
		expect(rows[0].durationMs).toBe(30_000);
	});
});

describe('standing', () => {
	const pool = [
		{ slug: 'a', value: 10 },
		{ slug: 'a', value: 50 }, // only a's best counts
		{ slug: 'b', value: 20 },
		{ slug: 'c', value: 30 },
		{ slug: 'd', value: 40 },
		{ slug: 'me', value: 999 } // own parses never count against yourself
	];
	test("percentile against everyone else's best", () => {
		expect(standing(35, 'me', 'dps', pool)).toEqual({ pct: 50, rank: 3, outOf: 5 });
		expect(standing(60, 'me', 'dps', pool)).toEqual({ pct: 100, rank: 1, outOf: 5 });
		expect(standing(5, 'me', 'dps', pool)).toEqual({ pct: 0, rank: 5, outOf: 5 });
	});
	test('too few others or a tank: rank only', () => {
		expect(standing(35, 'me', 'dps', pool.slice(0, 3))).toEqual({ pct: null, rank: 2, outOf: 3 });
		expect(standing(35, 'me', 'tank', pool).pct).toBeNull();
	});
});

describe('hero logs', () => {
	test('best, median, fastest and every kill per boss', () => {
		const base = {
			encounterId: 589,
			encounter: 'Skum',
			zone: 'Wailing Caverns',
			difficultyId: 1,
			role: 'dps' as const,
			hps: 0,
			taken: 0,
			ilvl: 18
		};
		const mine = [
			{ ...base, slug: 'me', runId: 'r1', dps: 30, durationMs: 40_000, at: 1 },
			{ ...base, slug: 'me', runId: 'r2', dps: 45, durationMs: 30_000, at: 2 }
		];
		const pool = [10, 20, 40, 50].map((value, i) => ({ slug: `o${i}`, value }));
		const out = heroLogs('me', mine, new Map([[poolKey(base), pool]]));
		expect(out.encounters).toHaveLength(1);
		const e = out.encounters[0];
		expect([e.kills, e.best, e.bestPct, e.medianPct, e.fastestMs]).toEqual([
			2, 45, 75, 62.5, 30_000
		]);
		expect(e.list.map((k) => k.runId)).toEqual(['r2', 'r1']); // newest first
		expect(out.bestPerfAvg).toBe(75);
	});
});

describe('patches and seasons', () => {
	test('version from the static namespace, season line = major.minor', () => {
		expect(
			patchFromNamespace(
				'https://eu.api.blizzard.com/data/wow/journal-expansion/?namespace=static-1.60.1_70399-forever-eu'
			)
		).toBe('1.60.1');
		expect(patchFromNamespace('static-forever-eu')).toBeNull();
		expect(patchLine('1.60.1')).toBe('1.60');
		expect(patchLine('1.61.12')).toBe('1.61');
	});
});
