// Validatorji za WowCompany Companion. Run povzetek se 1:1 ujema z Rust tipi v
// crates/wowrun/src/summary.rs (serde camelCase, Option -> null). Ob spremembi oblike
// dvigni SCHEMA_VERSION na obeh straneh.
import { v, type Infer } from 'convex/values';

export const SCHEMA_VERSION = 1;

const nullableNumber = v.union(v.number(), v.null());
const nullableString = v.union(v.string(), v.null());

export const spellStat = v.object({
	id: v.number(),
	name: v.string(),
	amount: v.number(),
	hits: v.number(),
	crits: v.number(),
	pet: v.boolean()
});

export const playerSummary = v.object({
	guid: v.string(),
	name: v.string(),
	slug: v.string(),
	recorder: v.boolean(),
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
	topHealing: v.array(spellStat)
});

export const segment = v.object({
	kind: v.union(v.literal('boss'), v.literal('trash')),
	name: v.string(),
	encounterId: nullableNumber,
	startMs: v.number(),
	endMs: v.number(),
	result: v.union(v.literal('kill'), v.literal('wipe'), v.literal('none')),
	players: v.array(
		v.object({ slug: v.string(), damage: v.number(), healing: v.number(), damageTaken: v.number() })
	)
});

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

/** Kar pošlje aplikacija (POST /companion/runs). */
export const runSummary = v.object({
	schema: v.literal(SCHEMA_VERSION),
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
	timeline
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
