// bun test — Dungeon Runs: obiskovalec vidi samo, kar dovolijo polja runs / runDetails / runDeaths / classId.
import { describe, expect, test } from 'bun:test';
import {
	runDetail,
	runListItem,
	type DetailsLike,
	type RunDocLike
} from '../src/convex/lib/runsView.ts';

const RUN: RunDocLike = {
	_id: 'r1',
	zone: { instanceId: 389, name: 'Ragefire Chasm', difficultyId: 1, instanceUid: 7001 },
	startedAt: 1000,
	endedAt: 1_801_000,
	durationMs: 1_800_000,
	endReason: 'leftInstance',
	result: { bossesKilled: 3, bossesTotal: 4, wipes: 1, cleared: false },
	party: [
		{ slug: 'tank-a', name: 'Tank A', playerId: 'p1', damage: 5000, healing: 0, deaths: 1 },
		{ slug: 'mage-b', name: 'Mage B', damage: 30000, healing: 0, deaths: 3 }
	],
	recordedBy: [
		{ userId: 'u1', deviceId: 'd1', slug: 'mage-b', at: 5 },
		{ userId: 'u2', deviceId: 'd2', slug: 'tank-a', at: 6 },
		{ userId: 'u2', deviceId: 'd3', slug: 'tank-a', at: 7 }
	],
	awards: [{ key: 'floorInspector', title: 'Floor Inspector', slug: 'mage-b', detail: 'x' }]
};

const P = (slug: string) => ({
	guid: `Player-1-${slug}`,
	name: slug,
	slug,
	recorder: false,
	level: null,
	damage: 1,
	healing: 0,
	overheal: 0,
	shielding: 0,
	damageTaken: 0,
	environmentalTaken: 0,
	deaths: 2,
	interrupts: 0,
	dispels: 0,
	activeMs: 0,
	dps: 0,
	hps: 0,
	critPct: 0,
	topDamage: [],
	topHealing: []
});
const DETAILS: DetailsLike = {
	players: [P('tank-a'), P('mage-b')],
	segments: [],
	deaths: [{ slug: 'mage-b', atMs: 10, killer: 'Oggleflint', killingBlow: 'Fireball', recap: [] }],
	timeline: { bucketMs: 10_000, players: [] },
	loot: [
		{
			slug: 'mage-b',
			looter: 'Mage B',
			item: 'Shiny Stick',
			itemId: 1,
			quality: 3,
			count: 1,
			atMs: 5
		}
	]
};
const classOf = new Map([['tank-a', 1]]);
const only =
	(...f: string[]) =>
	(k: string) =>
		f.includes(k);
const all = () => true;

describe('list item', () => {
	test('visitor with only "runs": identity, duration, party, recorders – no numbers, deaths, awards, classes', () => {
		const r = runListItem(RUN, classOf, only('runs'));
		expect(r.zone).toBe('Ragefire Chasm');
		expect(r.durationMs).toBe(1_800_000);
		expect(r.result.wipes).toBe(1);
		expect(r.party.map((p) => p.name)).toEqual(['Tank A', 'Mage B']);
		expect(
			r.party.every(
				(p) => p.damage === null && p.healing === null && p.deaths === null && p.classId === null
			)
		).toBe(true);
		expect(r.totalDeaths).toBeNull();
		expect(r.awards).toBeNull();
		expect(r.leader).toBeNull();
		expect(JSON.stringify(r)).not.toContain('30000');
	});
	test('recorders are deduplicated by hero and named from the party', () => {
		const r = runListItem(RUN, classOf, all);
		expect(r.recordedBy.map((x) => x.name)).toEqual(['Mage B', 'Tank A']);
	});
	test('member sees everything', () => {
		const r = runListItem(RUN, classOf, all);
		expect(r.totalDeaths).toBe(4);
		expect(r.party[0]).toMatchObject({ classId: 1, damage: 5000, deaths: 1, tracked: true });
		expect(r.party[1]).toMatchObject({ classId: null, tracked: false });
		expect(r.awards).toHaveLength(1);
	});
});

describe('detail', () => {
	test('runDetails without runDeaths: meter yes, deaths no (not even counts)', () => {
		const d = runDetail(RUN, DETAILS, classOf, only('runs', 'runDetails'));
		expect(d.players).toHaveLength(2);
		expect(d.players!.every((p) => p.deaths === null)).toBe(true);
		expect(d.deaths).toBeNull();
		expect(d.totalDeaths).toBeNull();
		expect(d.access).toEqual({ details: true, deaths: false, loot: false });
	});
	test('runDeaths without runDetails: autopsies yes, meter no', () => {
		const d = runDetail(RUN, DETAILS, classOf, only('runs', 'runDeaths'));
		expect(d.players).toBeNull();
		expect(d.segments).toBeNull();
		expect(d.timeline).toBeNull();
		expect(d.deaths).toHaveLength(1);
	});
	test('player GUIDs never reach the browser', () => {
		const d = runDetail(RUN, DETAILS, classOf, all);
		expect(JSON.stringify(d)).not.toContain('Player-1-');
	});
	test('missing details document is handled', () => {
		const d = runDetail(RUN, null, classOf, all);
		expect(d.players).toBeNull();
		expect(d.deaths).toBeNull();
	});
});

describe('loot visibility', () => {
	test('runLoot hidden → no loot and no count, even for numbers-allowed viewers', () => {
		const d = runDetail(
			{ ...RUN, lootCount: 1 },
			DETAILS,
			classOf,
			only('runs', 'runDetails', 'runDeaths')
		);
		expect(d.loot).toBeNull();
		expect(d.lootCount).toBeNull();
		expect(d.access.loot).toBe(false);
		expect(JSON.stringify(d)).not.toContain('Shiny Stick');
	});
	test('runLoot alone shows the loot list', () => {
		const d = runDetail({ ...RUN, lootCount: 1 }, DETAILS, classOf, only('runs', 'runLoot'));
		expect(d.loot).toHaveLength(1);
		expect(d.lootCount).toBe(1);
		expect(d.players).toBeNull();
	});
	test('old runs without loot field → empty list', () => {
		const { loot: _l, ...noLoot } = DETAILS;
		expect(runDetail(RUN, noLoot, classOf, all).loot).toEqual([]);
		expect(runListItem(RUN, classOf, all).lootCount).toBe(0);
	});
});
