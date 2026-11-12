import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const roleValidator = v.union(v.literal('admin'), v.literal('member'));
export const claimStatus = v.union(v.literal('pending'), v.literal('accepted'), v.literal('rejected'));

/** Polja povzetka lika (normalizirano iz Blizzarda). */
export const summaryFields = {
	slug: v.string(),
	name: v.string(),
	surname: v.string(),
	level: v.number(),
	experience: v.number(),
	classId: v.number(),
	className: v.string(),
	race: v.string(),
	faction: v.string(),
	gender: v.string(),
	guild: v.optional(v.string()),
	ruleset: v.optional(v.string()),
	ilvlEquipped: v.number(), // Blizzard equipped_item_level
	ilvlAverage: v.number(), // Blizzard average_item_level
	achievementPoints: v.number(),
	avatar: v.optional(v.string()),
	lastLogin: v.optional(v.number()),
	kills: v.number(),
	deaths: v.number(),
	quests: v.number(),
	honorableKills: v.number(),
	/** zabavni števci za lestvice (hrana, smrti zaradi padca ...) */
	counters: v.optional(v.record(v.string(), v.number())),
	/** talenti: "5/22/0" in drevo z največ točkami (vidnost: polje 'talents') */
	talentBuild: v.optional(v.string()),
	talentSpec: v.optional(v.string())
};

/** Veliki podatki za stran lika. */
export const detailFields = {
	render: v.optional(v.string()),
	equipment: v.any(), // Item[] (glej lib/normalize.ts)
	stats: v.any(), // Stats | null
	professions: v.any(), // Profession[]
	counters: v.record(v.string(), v.number()),
	allStats: v.any(), // StatLine[]
	talents: v.optional(v.any()) // TalentTree[] (glej lib/normalize.ts)
};

export default defineSchema({
	// Vloge. Uporabniki sami živijo v Better Auth komponenti; tu je samo vloga.
	// Prvi uporabnik platforme dobi 'admin' (glej auth.ts -> triggers).
	roles: defineTable({
		userId: v.string(),
		email: v.string(),
		name: v.optional(v.string()),
		role: roleValidator,
		createdAt: v.number()
	})
		.index('by_user', ['userId'])
		.index('by_role', ['role']),

	// Zahteve za dodajanje lika (uporabnik -> admin potrdi).
	claims: defineTable({
		userId: v.string(),
		email: v.string(),
		name: v.string(), // "Sinek Helgater"
		slug: v.string(), // "sinek-helgater"
		preview: v.object({
			level: v.number(),
			race: v.string(),
			className: v.string(),
			classId: v.number(),
			guild: v.optional(v.string())
		}),
		status: claimStatus,
		createdAt: v.number(),
		decidedAt: v.optional(v.number()),
		decidedBy: v.optional(v.string())
	})
		.index('by_status', ['status'])
		.index('by_user', ['userId'])
		.index('by_slug', ['slug']),

	// Spremljani liki.
	players: defineTable({
		slug: v.string(),
		displayName: v.string(),
		ownerUserId: v.optional(v.string()),
		addedAt: v.number(),
		active: v.boolean()
	}).index('by_slug', ['slug']),

	// EN dokument, ki ga cron prebere vsako minuto (majhen -> malo DB I/O).
	pollState: defineTable({
		key: v.literal('main'),
		lastRunAt: v.optional(v.number()),
		entries: v.array(
			v.object({
				playerId: v.id('players'),
				slug: v.string(),
				lastModified: v.optional(v.string()), // HTTP Last-Modified profila
				lastLogin: v.optional(v.number())
			})
		)
	}).index('by_key', ['key']),

	// Majhen povzetek za seznam / lestvice (en dokument na igralca).
	summaries: defineTable({ playerId: v.id('players'), ...summaryFields, updatedAt: v.number() })
		.index('by_player', ['playerId'])
		.index('by_slug', ['slug']),

	// Veliki podatki za stran lika (berejo se samo tam).
	details: defineTable({ playerId: v.id('players'), ...detailFields, updatedAt: v.number() }).index(
		'by_player',
		['playerId']
	),

	// Zgodovina: nova vrstica samo, ko se kaj spremeni.
	history: defineTable({
		playerId: v.id('players'),
		at: v.number(),
		level: v.number(),
		ilvl: v.number(),
		kills: v.number(),
		deaths: v.number(),
		quests: v.number(),
		honorableKills: v.number()
	}).index('by_player_at', ['playerId', 'at']),

	// Dogodki (povzetek seje, level up, nov predmet ...) za Discord in feed.
	events: defineTable({
		playerId: v.id('players'),
		at: v.number(),
		type: v.string(),
		payload: v.any(),
		postedAt: v.optional(v.number())
	})
		.index('by_at', ['at'])
		.index('by_posted', ['postedAt']),

	// Nastavitve platforme (en dokument).
	settings: defineTable({
		key: v.literal('main'),
		pollIntervalSec: v.number(),
		publicFields: v.array(v.string()),
		/** kaj gre v Discord (objave + slash ukazi); manjka = vse */
		discordFields: v.optional(v.array(v.string())),
		paused: v.boolean()
	}).index('by_key', ['key']),

	// Skrivnosti, nastavljene prek admin vmesnika (Portal Room). Berejo jih SAMO interne funkcije;
	// v brskalnik nikoli ne gredo. Manjkajoče vrednosti -> rezerva iz okoljskih spremenljivk.
	secrets: defineTable({
		key: v.literal('discord'),
		webhookUrl: v.optional(v.string()),
		webhookName: v.optional(v.string()),
		webhookChannelId: v.optional(v.string()),
		botToken: v.optional(v.string()),
		applicationId: v.optional(v.string()),
		applicationName: v.optional(v.string()),
		publicKey: v.optional(v.string()),
		guildId: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Trajni predpomnilnik talentov (največji rang + ikona) – en Blizzard klic na talent za vedno.
	talentInfo: defineTable({
		talentId: v.number(),
		maxRank: v.number(),
		icon: v.union(v.string(), v.null())
	}).index('by_talent', ['talentId']),

	// Drevesa talentov po razredih (vrstni red + imena, tudi drevesa brez točk).
	classSpecs: defineTable({
		classId: v.number(),
		specs: v.array(v.object({ id: v.number(), name: v.string() }))
	}).index('by_class', ['classId']),

	// Trajni predpomnilnik ikon predmetov.
	itemIcons: defineTable({
		itemId: v.number(),
		url: v.union(v.string(), v.null())
	}).index('by_item', ['itemId']),

	// Guild roster za predloge imen (osvežen 1x na dan).
	guildRoster: defineTable({
		key: v.literal('main'),
		fetchedAt: v.number(),
		members: v.array(
			v.object({
				name: v.string(),
				surname: v.string(),
				slug: v.string(),
				level: v.number(),
				classId: v.number()
			})
		)
	}).index('by_key', ['key'])
});
