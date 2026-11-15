// Validatorji za WowCompany Companion. Run povzetek se 1:1 ujema z Rust tipi v
// crates/wowrun/src/summary.rs (serde camelCase, Option -> null). Ob spremembi oblike
// dvigni SCHEMA_VERSION na obeh straneh.
import { v, type Infer } from 'convex/values';

/** Najnovejša shema (Rust `SCHEMA_VERSION`). 1 = brez loota (aplikacija v0.1.0), 2 = + loot, 3 = + rekordi igralcev,
 * 4 = + razčlenitev po bossih (uroki s casti/min/max, tarče, ilvl), casti in oprema igralcev (vse neobvezno). */
export const SCHEMA_VERSION = 4;
export const SUPPORTED_SCHEMAS = [1, 2, 3, 4];

const nullableNumber = v.union(v.number(), v.null());
const nullableString = v.union(v.string(), v.null());

export const spellStat = v.object({
	id: v.number(),
	name: v.string(),
	amount: v.number(),
	hits: v.number(),
	crits: v.number(),
	pet: v.boolean(),
	/** shema 4 */
	casts: v.optional(v.number()),
	min: v.optional(v.number()),
	max: v.optional(v.number()),
	overheal: v.optional(v.number())
});

export const castStat = v.object({
	id: v.number(),
	name: v.string(),
	count: v.number(),
	pet: v.boolean()
});
export const targetStat = v.object({ name: v.string(), amount: v.number() });
export const gearItem = v.object({ itemId: v.number(), ilvl: v.number() });
export const auraStat = v.object({ id: v.number(), name: v.string(), uptimeMs: v.number() });
const hitPart = v.object({
	amount: v.number(),
	hits: v.number(),
	crits: v.number(),
	misses: v.number()
});
const namedCount = v.object({ name: v.string(), count: v.number() });
/** Kot Combat Log Config v igri: "My actions" in "What happened to me?" (Companion v0.1.11+). */
export const combatLogStats = v.object({
	mine: v.object({
		melee: hitPart,
		ranged: hitPart,
		spells: hitPart,
		periodic: hitPart,
		heals: v.number(),
		periodicHeals: v.number(),
		powerGains: v.number(),
		drains: v.number(),
		interrupts: v.number(),
		extraAttacks: v.number(),
		summons: v.number(),
		resurrections: v.number(),
		dispels: v.number(),
		castsStarted: v.number(),
		casts: v.number(),
		castsFailed: v.number(),
		failReasons: v.array(namedCount),
		kills: v.number(),
		damageShields: v.number(),
		misses: v.array(namedCount)
	}),
	me: v.object({
		melee: hitPart,
		ranged: hitPart,
		spells: hitPart,
		periodic: hitPart,
		environmental: v.number(),
		healsReceived: v.number(),
		deaths: v.number(),
		avoided: v.array(namedCount)
	})
});
export type CombatLogStats = Infer<typeof combatLogStats>;

export const bossTimeline = v.object({
	bucketMs: v.number(),
	damage: v.array(v.number()),
	healing: v.array(v.number()),
	taken: v.array(v.number())
});

export const recordKind = v.union(
	v.literal('crit'),
	v.literal('hit'),
	v.literal('critHeal'),
	v.literal('heal'),
	v.literal('hitTaken')
);

/** Največji posamezen dogodek ene vrste v runu (shema 3). `unit` = tarča, pri hitTaken napadalec. */
export const runRecord = v.object({
	kind: recordKind,
	amount: v.number(),
	spell: v.string(),
	spellId: v.number(),
	unit: nullableString,
	atMs: v.number(),
	pet: v.boolean()
});

export const playerSummary = v.object({
	guid: v.string(),
	name: v.string(),
	slug: v.string(),
	recorder: v.boolean(),
	/** advanced-log `level` = equipped item level (not the character level) */
	level: nullableNumber,
	damage: v.number(),
	healing: v.number(),
	overheal: v.number(),
	shielding: v.number(),
	damageTaken: v.number(),
	environmentalTaken: v.number(),
	deaths: v.number(),
	interrupts: v.number(),
	dispels: v.number(),
	activeMs: v.number(),
	dps: v.number(),
	hps: v.number(),
	critPct: v.number(),
	topDamage: v.array(spellStat),
	topHealing: v.array(spellStat),
	records: v.optional(v.array(runRecord)),
	/** shema 4: casti (tudi uroki brez škode) in oprema ob zadnjem bossu (COMBATANT_INFO) */
	casts: v.optional(v.array(castStat)),
	gear: v.optional(v.array(gearItem)),
	combat: v.optional(combatLogStats)
});

export const segment = v.object({
	kind: v.union(v.literal('boss'), v.literal('trash')),
	name: v.string(),
	encounterId: nullableNumber,
	startMs: v.number(),
	endMs: v.number(),
	result: v.union(v.literal('kill'), v.literal('wipe'), v.literal('none')),
	players: v.array(
		v.object({
			slug: v.string(),
			damage: v.number(),
			healing: v.number(),
			damageTaken: v.number(),
			/** shema 4 (podrobnosti samo pri bossih) */
			ilvl: v.optional(v.number()),
			activeMs: v.optional(v.number()),
			interrupts: v.optional(v.number()),
			dispels: v.optional(v.number()),
			deaths: v.optional(v.number()),
			spells: v.optional(v.array(spellStat)),
			heals: v.optional(v.array(spellStat)),
			casts: v.optional(v.array(castStat)),
			targets: v.optional(v.array(targetStat)),
			buffs: v.optional(v.array(auraStat)),
			debuffs: v.optional(v.array(auraStat)),
			timeline: v.optional(bossTimeline),
			combat: v.optional(combatLogStats),
			/** razčlenitev je v runBossDetails (strežnik jo prestavi tja ob uploadu) */
			hasDetail: v.optional(v.boolean())
		})
	)
});

/** Razčlenitev igralca v enem boss boju (ločen dokument `runBossDetails`, bere se ob kliku – DB I/O). */
export const bossDetailPlayer = v.object({
	slug: v.string(),
	spells: v.optional(v.array(spellStat)),
	heals: v.optional(v.array(spellStat)),
	casts: v.optional(v.array(castStat)),
	targets: v.optional(v.array(targetStat)),
	buffs: v.optional(v.array(auraStat)),
	debuffs: v.optional(v.array(auraStat)),
	timeline: v.optional(bossTimeline),
	combat: v.optional(combatLogStats)
});
export type BossDetailPlayer = Infer<typeof bossDetailPlayer>;

export const death = v.object({
	slug: v.string(),
	atMs: v.number(),
	killer: nullableString,
	killingBlow: nullableString,
	recap: v.array(
		v.object({
			atMs: v.number(),
			source: nullableString,
			spell: nullableString,
			amount: v.number(),
			overkill: v.number(),
			hp: nullableNumber,
			maxHp: nullableNumber
		})
	)
});

export const timeline = v.object({
	bucketMs: v.number(),
	players: v.array(
		v.object({
			slug: v.string(),
			damage: v.array(v.number()),
			healing: v.array(v.number()),
			taken: v.array(v.number())
		})
	)
});

export const zone = v.object({
	instanceId: v.number(),
	name: v.string(),
	difficultyId: v.number(),
	instanceUid: nullableNumber
});

export const endReason = v.union(
	v.literal('leftInstance'),
	v.literal('newInstance'),
	v.literal('instanceReset'),
	v.literal('inactivity'),
	v.literal('endOfLog'),
	v.literal('manual'),
	v.literal('inProgress')
);

export const runResult = v.object({
	bossesKilled: v.number(),
	bossesTotal: nullableNumber,
	wipes: v.number(),
	cleared: v.boolean()
});

export const lootDrop = v.object({
	slug: nullableString,
	looter: v.string(),
	item: v.string(),
	itemId: nullableNumber,
	quality: nullableNumber,
	count: v.number(),
	atMs: v.number()
});

/** Need/greed roll za en predmet (iz /chatlog; samo člani partyja). */
export const rollEntry = v.object({
	slug: v.string(),
	name: v.string(),
	choice: v.union(v.literal('need'), v.literal('greed'), v.literal('pass')),
	roll: nullableNumber
});
export const lootRoll = v.object({
	item: v.string(),
	itemId: nullableNumber,
	quality: nullableNumber,
	atMs: v.number(),
	/** slug zmagovalca; null = vsi so passali */
	winner: nullableString,
	entries: v.array(rollEntry)
});

export const castFails = v.object({
	total: v.number(),
	spam: v.number(),
	targeting: v.number(),
	range: v.number(),
	resources: v.number(),
	interrupted: v.number(),
	control: v.number(),
	other: v.number(),
	reasons: v.array(v.object({ name: v.string(), count: v.number() }))
});
export type CastFails = Infer<typeof castFails>;

/** Kar je snemalec pridobil v runu (iz /chatlog): XP, denar, reputacija, veščine, leveli. Samo snemalec. */
export const runProgress = v.object({
	xp: v.number(),
	xpBonus: v.number(),
	/** v bakrenikih */
	copper: v.number(),
	reputation: v.array(v.object({ faction: v.string(), amount: v.number() })),
	skills: v.array(v.object({ skill: v.string(), from: v.number(), to: v.number() })),
	levels: v.array(v.number()),
	/** snemalčevi neuspeli casti po vrstah (SPELL_CAST_FAILED je v logu samo za lastnika) */
	castFails: v.optional(castFails)
});
export type RunProgress = Infer<typeof runProgress>;

/** Osebni rekord iz celega loga (tudi open world) – Rust `wowrun::personal`. `at` = UTC ms. */
export const personalRecord = v.object({
	kind: recordKind,
	amount: v.number(),
	spell: v.string(),
	spellId: v.number(),
	unit: nullableString,
	at: v.number(),
	zone: nullableString,
	inDungeon: v.boolean()
});

/** Kar pošlje aplikacija na POST /companion/records. */
export const personalUpload = v.object({
	schema: v.literal(1),
	characters: v.array(
		v.object({ slug: v.string(), name: v.string(), records: v.array(personalRecord) })
	)
});

/** Kar pošlje aplikacija (POST /companion/runs). */
export const runSummary = v.object({
	schema: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
	runKey: v.string(),
	zone,
	startedAt: v.number(),
	endedAt: v.number(),
	durationMs: v.number(),
	endReason,
	result: runResult,
	recorder: nullableString,
	players: v.array(playerSummary),
	segments: v.array(segment),
	deaths: v.array(death),
	timeline,
	loot: v.optional(v.array(lootDrop)),
	/** vodja partyja – iz addona WowCompany (combat log ga ne pozna) */
	leader: v.optional(v.string()),
	/** need/greed rolli (Companion v0.1.7+) */
	rolls: v.optional(v.array(lootRoll)),
	/** pridobitve snemalca (Companion v0.1.11+) */
	progress: v.optional(runProgress)
});

export const award = v.object({
	key: v.string(),
	title: v.string(),
	slug: v.string(),
	detail: v.string()
});

export const partyMember = v.object({
	slug: v.string(),
	name: v.string(),
	playerId: v.optional(v.id('players')),
	damage: v.number(),
	healing: v.number(),
	deaths: v.number()
});

export const recorder = v.object({
	userId: v.string(),
	deviceId: v.id('devices'),
	slug: nullableString,
	at: v.number()
});

export const linkStatus = v.union(
	v.literal('pending'),
	v.literal('approved'),
	v.literal('denied'),
	v.literal('claimed')
);

export type RunSummary = Infer<typeof runSummary>;
export type PlayerSummary = Infer<typeof playerSummary>;
export type Award = Infer<typeof award>;
export type LootDrop = Infer<typeof lootDrop>;
export type LootRoll = Infer<typeof lootRoll>;
export type Segment = Infer<typeof segment>;
export type RunRecord = Infer<typeof runRecord>;
export type RecordKind = Infer<typeof recordKind>;
export type PersonalUpload = Infer<typeof personalUpload>;
