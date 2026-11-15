// bun test — Companion: validacija runa, nagrade, ocena popolnosti, kode za povezavo.
import { describe, expect, test } from 'bun:test';
import {
	addRecorder,
	beatsRecord,
	castFailAwards,
	checkPersonal,
	checkRun,
	computeAwards,
	makeLinkCode,
	MAX_LOOT,
	normalizeCode,
	runScore,
	splitBossDetails
} from '../src/convex/lib/companion.ts';
import type { PlayerSummary, RunSummary } from '../src/convex/lib/companionSchema.ts';

const NOW = Date.UTC(2026, 10, 20, 20, 0, 0);

const P = (slug: string, o: Partial<PlayerSummary> = {}): PlayerSummary => ({
	guid: `Player-1-${slug}`,
	name: slug,
	slug,
	recorder: false,
	level: null,
	damage: 0,
	healing: 0,
	overheal: 0,
	shielding: 0,
	damageTaken: 0,
	environmentalTaken: 0,
	deaths: 0,
	interrupts: 0,
	dispels: 0,
	activeMs: 0,
	dps: 0,
	hps: 0,
	critPct: 0,
	topDamage: [],
	topHealing: [],
	...o
});

const RUN = (o: Partial<RunSummary> = {}): RunSummary => ({
	schema: 1,
	runKey: '0123456789abcdef',
	zone: { instanceId: 389, name: 'Ragefire Chasm', difficultyId: 1, instanceUid: 7001 },
	startedAt: NOW - 3_600_000,
	endedAt: NOW - 1_800_000,
	durationMs: 1_800_000,
	endReason: 'leftInstance',
	result: { bossesKilled: 2, bossesTotal: 4, wipes: 1, cleared: false },
	recorder: 'grobos-stinkfoot',
	players: [P('grobos-stinkfoot', { recorder: true }), P('fizzle-boom')],
	segments: [],
	deaths: [],
	timeline: { bucketMs: 10_000, players: [] },
	...o
});

describe('checkRun', () => {
	test('accepts a sane run', () => expect(checkRun(RUN(), NOW)).toBeNull());
	test('diacritics in slugs are fine', () =>
		expect(
			checkRun(RUN({ recorder: null, players: [P('elfrida-ástrún'), P('fizzle-boom')] }), NOW)
		).toBeNull());
	test.each([
		['too many players', RUN({ players: Array.from({ length: 11 }, (_, i) => P(`p-${i}x`)) })],
		['no players', RUN({ players: [], recorder: null })],
		['bad runKey', RUN({ runKey: 'nope' })],
		['zero duration', RUN({ durationMs: 0, endedAt: NOW - 3_600_000 })],
		['7 hour run', RUN({ durationMs: 7 * 3_600_000, endedAt: NOW - 3_600_000 + 7 * 3_600_000 })],
		['in progress', RUN({ endReason: 'inProgress' })],
		[
			'ancient',
			RUN({ startedAt: NOW - 40 * 86_400_000, endedAt: NOW - 40 * 86_400_000 + 1_800_000 })
		],
		['future', RUN({ startedAt: NOW + 3 * 86_400_000, endedAt: NOW + 3 * 86_400_000 + 1_800_000 })],
		['end mismatch', RUN({ endedAt: NOW })],
		['duplicate slugs', RUN({ players: [P('fizzle-boom'), P('fizzle-boom')], recorder: null })],
		['weird slug', RUN({ players: [P('<script>'), P('fizzle-boom')], recorder: null })],
		['recorder outside party', RUN({ recorder: 'someone-else' })]
	])('rejects %s', (_, run) => expect(checkRun(run, NOW)).not.toBeNull());
});

describe('runScore', () => {
	test('more bosses beats slightly longer', () => {
		const a = RUN();
		const b = RUN({ durationMs: a.durationMs + 60_000, result: { ...a.result, bossesKilled: 1 } });
		expect(runScore(a)).toBeGreaterThan(runScore(b));
	});
	test('longer wins when bosses equal', () => {
		expect(runScore(RUN({ durationMs: 2_000_000 }))).toBeGreaterThan(runScore(RUN()));
	});
});

describe('computeAwards', () => {
	const party = [
		P('tank', { damage: 5000, dps: 10, damageTaken: 20000, interrupts: 4 }),
		P('mage', { damage: 30000, dps: 60, deaths: 3, environmentalTaken: 1200 }),
		P('healer', { healing: 20000, overheal: 9000, damage: 100, dps: 0.2 }),
		P('rogue', { damage: 20000, dps: 40, deaths: 1 })
	];
	const awards = computeAwards(party);
	const who = (key: string) => awards.find((a) => a.key === key)?.slug;

	test('each award goes to the right idiot', () => {
		expect(who('mainCharacter')).toBe('mage');
		expect(who('floorInspector')).toBe('mage');
		expect(who('pyromaniac')).toBe('mage');
		expect(who('bulletSponge')).toBe('tank');
		expect(who('overhealer')).toBe('healer');
		expect(who('shutUp')).toBe('tank');
		expect(who('pacifist')).toBe('tank'); // healer excluded (healing > damage)
	});
	test('English and grammatical', () => {
		expect(awards.find((a) => a.key === 'floorInspector')!.detail).toContain('3 times');
		const one = computeAwards([P('a', { deaths: 1 }), P('b')]);
		expect(one.find((a) => a.key === 'floorInspector')!.detail).toContain('1 time.');
	});
	test('nothing silly for a clean, empty run', () => {
		expect(computeAwards([P('a'), P('b')])).toEqual([]);
		expect(computeAwards([])).toEqual([]);
	});
});

describe('link codes & recorders', () => {
	test('code format', () => {
		let i = 0;
		const seq = [3, 1234, 7, 9999];
		const code = makeLinkCode(() => seq[i++ % seq.length]);
		expect(code).toMatch(/^[A-Z]+-\d{4}$/);
		expect(normalizeCode(' murloc-4821 ')).toBe('MURLOC-4821');
	});
	test('recorder added once per device', () => {
		const r1 = { deviceId: 'd1', userId: 'u1' };
		const a = addRecorder([], r1);
		expect(a.added).toBe(true);
		expect(addRecorder(a.list, { deviceId: 'd1', userId: 'u1' }).added).toBe(false);
		expect(addRecorder(a.list, { deviceId: 'd2', userId: 'u2' }).list).toHaveLength(2);
	});
});

describe('loot (schema 2)', () => {
	const L = (slug: string | null, item = 'Linen Cloth', count = 1) => ({
		slug,
		looter: slug ?? 'Bob',
		item,
		itemId: null,
		quality: 1,
		count,
		atMs: 1000
	});
	test('schema 2 run with loot is accepted, absurd loot is not', () => {
		expect(checkRun(RUN({ schema: 2, loot: [L('fizzle-boom')] }), NOW)).toBeNull();
		expect(
			checkRun(
				RUN({ schema: 2, loot: Array.from({ length: MAX_LOOT + 1 }, () => L('fizzle-boom')) }),
				NOW
			)
		).toContain('too much loot');
		expect(checkRun(RUN({ schema: 2, loot: [L('fizzle-boom', '')] }), NOW)).toBe('bad loot entry');
		expect(checkRun(RUN({ schema: 2, loot: [L('fizzle-boom', 'x', 0)] }), NOW)).toBe(
			'bad loot entry'
		);
	});
	test('Loot Goblin goes to the greediest (3+ items, matched slugs only)', () => {
		const party = [P('a', { damage: 1 }), P('b', { damage: 1 })];
		const loot = [L('a'), L('b'), L('b'), L('b'), L(null), L(null), L(null), L(null)];
		const goblin = computeAwards(party, loot).find((x) => x.key === 'lootGoblin');
		expect(goblin?.slug).toBe('b');
		expect(goblin?.detail).toContain('3 items');
		expect(
			computeAwards(party, [L('a'), L('a')]).find((x) => x.key === 'lootGoblin')
		).toBeUndefined();
	});
});

describe('need/greed rolls', () => {
	const roll = (o: object = {}, entry: object = {}) => ({
		item: 'Gleaming Claymore of the Wolf',
		itemId: null,
		quality: 2,
		atMs: 60_000,
		winner: 'fizzle-boom',
		entries: [
			{ slug: 'fizzle-boom', name: 'Fizzle Boom', choice: 'greed' as const, roll: 97 },
			{
				slug: 'grobos-stinkfoot',
				name: 'Grobos Stinkfoot',
				choice: 'pass' as const,
				roll: null,
				...entry
			}
		],
		...o
	});
	test('party rolls are accepted, old runs without rolls too', () => {
		expect(checkRun(RUN({ schema: 3, rolls: [roll()] }), NOW)).toBeNull();
		expect(checkRun(RUN({ schema: 3, rolls: [roll({ winner: null })] }), NOW)).toBeNull();
		expect(checkRun(RUN({ schema: 3 }), NOW)).toBeNull();
	});
	test('strangers and impossible dice are refused', () => {
		expect(checkRun(RUN({ schema: 3, rolls: [roll({ winner: 'random-stranger' })] }), NOW)).toBe(
			'bad roll entry'
		);
		expect(checkRun(RUN({ schema: 3, rolls: [roll({}, { slug: 'random-stranger' })] }), NOW)).toBe(
			'bad roll entry'
		);
		expect(
			checkRun(RUN({ schema: 3, rolls: [roll({}, { choice: 'need', roll: 101 })] }), NOW)
		).toBe('bad roll entry');
	});
});

describe('records (schema 3)', () => {
	const R = (kind: 'crit' | 'hit' | 'heal' | 'critHeal' | 'hitTaken', amount: number, o = {}) => ({
		kind,
		amount,
		spell: 'Fireball',
		spellId: 133,
		unit: 'Oggleflint' as string | null,
		atMs: 5000,
		pet: false,
		...o
	});
	const run = (records: ReturnType<typeof R>[]) =>
		RUN({
			schema: 3,
			players: [P('grobos-stinkfoot', { recorder: true, records }), P('fizzle-boom')]
		});

	test('sane records are accepted; old runs without records too', () => {
		expect(checkRun(run([R('crit', 1204), R('hitTaken', 800, { unit: null })]), NOW)).toBeNull();
		expect(checkRun(RUN({ schema: 3 }), NOW)).toBeNull();
	});
	test('duplicates, nonsense amounts and out-of-run times are rejected', () => {
		expect(checkRun(run([R('crit', 1), R('crit', 2)]), NOW)).toBe('bad records');
		expect(checkRun(run([R('crit', 0)]), NOW)).toBe('bad record entry');
		expect(checkRun(run([R('crit', Infinity)]), NOW)).toBe('bad record entry');
		expect(checkRun(run([R('crit', 5, { spell: '' })]), NOW)).toBe('bad record entry');
		expect(checkRun(run([R('crit', 5, { atMs: -1 })]), NOW)).toBe('bad record entry');
		expect(checkRun(run([R('crit', 5, { atMs: 7 * 3_600_000 })]), NOW)).toBe('bad record entry');
		// lava after the last fight: later than the run's duration, still fine
		expect(checkRun(run([R('hitTaken', 700, { atMs: 1_800_000 + 20_000 })]), NOW)).toBeNull();
	});
	test('One-Shot Wonder goes to the biggest crit, plain hits do not count', () => {
		const party = [
			P('a', { damage: 1, records: [R('crit', 900), R('hit', 5000)] }),
			P('b', { damage: 1, records: [R('crit', 1204, { spell: 'Pyroblast' })] })
		];
		const boom = computeAwards(party).find((x) => x.key === 'oneShotWonder');
		expect(boom?.slug).toBe('b');
		expect(boom?.detail).toContain('1,204 Pyroblast crit into Oggleflint');
		expect(
			computeAwards([P('a', { damage: 1, records: [R('hit', 5000)] })]).find(
				(x) => x.key === 'oneShotWonder'
			)
		).toBeUndefined();
	});
	test('a hero record is replaced only by a bigger number', () => {
		expect(beatsRecord(null, { amount: 1 })).toBe(true);
		expect(beatsRecord({ amount: 100 }, { amount: 100 })).toBe(false);
		expect(beatsRecord({ amount: 100 }, { amount: 101 })).toBe(true);
	});
});

describe('personal records (open world)', () => {
	const R = (o = {}) => ({
		kind: 'crit' as const,
		amount: 420,
		spell: 'Fireball',
		spellId: 133,
		unit: 'Mottled Boar' as string | null,
		at: NOW - 60_000,
		zone: 'Durotar' as string | null,
		inDungeon: false,
		...o
	});
	const U = (records = [R()], slug = 'grobos-stinkfoot') => ({
		schema: 1 as const,
		characters: [{ slug, name: 'Grobos Stinkfoot', records }]
	});
	test('a sane upload passes, unknown zone and no unit are fine', () => {
		expect(checkPersonal(U(), NOW)).toBeNull();
		expect(checkPersonal(U([R({ zone: null, unit: null })]), NOW)).toBeNull();
	});
	test('garbage is rejected', () => {
		expect(checkPersonal({ schema: 1, characters: [] }, NOW)).toContain('characters must be');
		expect(checkPersonal(U([R()], 'x y'), NOW)).toBe('bad slugs');
		expect(checkPersonal(U([R(), R()]), NOW)).toBe('bad records');
		expect(checkPersonal(U([R({ amount: 0 })]), NOW)).toBe('bad record entry');
		expect(checkPersonal(U([R({ amount: NaN })]), NOW)).toBe('bad record entry');
		expect(checkPersonal(U([R({ spell: '' })]), NOW)).toBe('bad record entry');
		expect(checkPersonal(U([R({ at: NOW + 2 * 86_400_000 })]), NOW)).toBe('bad record entry');
		expect(checkPersonal(U([R({ at: NOW - 400 * 86_400_000 })]), NOW)).toBe('bad record entry');
	});
});

describe('party leader (from the addon)', () => {
	test('a sane leader passes, nonsense does not', () => {
		expect(checkRun(RUN({ schema: 3, leader: 'Fizzle Boom' }), NOW)).toBeNull();
		expect(checkRun(RUN({ schema: 3, leader: 'x' }), NOW)).toBe('bad leader');
		expect(checkRun(RUN({ schema: 3, leader: 'x'.repeat(81) }), NOW)).toBe('bad leader');
	});
});

describe('boss details are stored apart (DB I/O)', () => {
	test('heavy lists move out, totals stay, players without detail untouched', () => {
		const seg = {
			kind: 'boss' as const,
			name: 'Skum',
			encounterId: 589,
			startMs: 0,
			endMs: 30_000,
			result: 'kill' as const,
			players: [
				{
					slug: 'fizzle-boom',
					damage: 3000,
					healing: 0,
					damageTaken: 100,
					spells: [{ id: 133, name: 'Fireball', amount: 3000, hits: 10, crits: 2, pet: false }],
					buffs: [{ id: 1459, name: 'Arcane Intellect', uptimeMs: 30_000 }]
				},
				{ slug: 'mendy-bandage', damage: 10, healing: 900, damageTaken: 0 }
			]
		};
		const { slim, details } = splitBossDetails([seg]);
		expect(slim[0].players[0]).toEqual({
			slug: 'fizzle-boom',
			damage: 3000,
			healing: 0,
			damageTaken: 100,
			hasDetail: true
		});
		expect(slim[0].players[1]).toEqual(seg.players[1]);
		expect(details).toEqual([
			{
				index: 0,
				players: [
					{ slug: 'fizzle-boom', spells: seg.players[0].spells, buffs: seg.players[0].buffs }
				]
			}
		]);
	});
});

describe('recorder progress (XP, money, reputation)', () => {
	const G = (o: object = {}) => ({
		xp: 8348,
		xpBonus: 2467,
		copper: 1605,
		reputation: [{ faction: 'Thunder Bluff', amount: 25 }],
		skills: [{ skill: 'Wands', from: 90, to: 97 }],
		levels: [21],
		...o
	});
	test('sane gains are accepted', () =>
		expect(checkRun(RUN({ schema: 4, progress: G() }), NOW)).toBeNull());
	test('impossible gains are refused', () => {
		expect(checkRun(RUN({ schema: 4, progress: G({ xpBonus: 9999 }) }), NOW)).toBe('bad progress');
		expect(
			checkRun(
				RUN({ schema: 4, progress: G({ skills: [{ skill: 'Wands', from: 97, to: 90 }] }) }),
				NOW
			)
		).toBe('bad progress');
		expect(checkRun(RUN({ schema: 4, progress: G({ levels: [0] }) }), NOW)).toBe('bad progress');
	});
});

describe('failed-cast awards', () => {
	const F = (o: object) => ({
		total: 0,
		spam: 0,
		targeting: 0,
		range: 0,
		resources: 0,
		interrupted: 0,
		control: 0,
		other: 0,
		reasons: [],
		...o
	});
	test('the worst recorder above the bar gets it, quiet runs get nothing', () => {
		const a = castFailAwards([
			{ slug: 'fizzle-boom', castFails: F({ spam: 191, targeting: 97, resources: 3 }) },
			{ slug: 'mendy-bandage', castFails: F({ spam: 60, resources: 40 }) },
			{ slug: 'no-companion' }
		]);
		// at most two per hero, the ones furthest above the bar (191/50 spam, 97/20 targeting)
		expect(a.map((x) => [x.title, x.slug])).toEqual([
			['Shadowboxer', 'fizzle-boom'],
			['Keyboard Diarrhea', 'fizzle-boom'],
			['Running on Fumes', 'mendy-bandage']
		]);
		expect(a[1].detail).toContain('191 times');
		const alone = castFailAwards([
			{
				slug: 'x',
				castFails: F({
					spam: 191,
					targeting: 97,
					interrupted: 80,
					resources: 56,
					range: 22,
					control: 7
				})
			}
		]);
		expect(alone).toHaveLength(2);
		expect(castFailAwards([{ slug: 'x', castFails: F({ spam: 10 }) }])).toEqual([]);
	});
});
