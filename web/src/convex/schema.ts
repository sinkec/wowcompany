import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
	award,
	death,
	endReason,
	linkStatus,
	lootDrop,
	lootRoll,
	bossDetailPlayer,
	castFails,
	partyMember,
	playerSummary,
	recordKind,
	recorder,
	replay,
	itemDetail,
	runResult,
	segment,
	timeline,
	zone
} from './lib/companionSchema.js';

export const roleValidator = v.union(v.literal('admin'), v.literal('member'));
export const claimStatus = v.union(
	v.literal('pending'),
	v.literal('accepted'),
	v.literal('rejected')
);

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
		active: v.boolean(),
		/** ključ arhiva (realm, s katerega je druščina odšla) – junak je takrat tudi active=false */
		archived: v.optional(v.string())
	})
		.index('by_slug', ['slug'])
		.index('by_archived', ['archived'])
		.index('by_owner', ['ownerUserId']),

	// Uporabniški profil (ime/priimek, glavni junak). Better Auth hrani samo Googlovo ime.
	profiles: defineTable({
		userId: v.string(),
		firstName: v.string(),
		lastName: v.string(),
		mainSlug: v.optional(v.string()),
		/** Settings → Account → Time & date (lib/timePrefs.ts) */
		timeZone: v.optional(v.string()),
		hour12: v.optional(v.boolean()),
		dateFormat: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_user', ['userId']),

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

	// Veriga pollerja: vsak zagon načrtuje naslednjega (scheduler), pavza = brez naslednjega zagona.
	// `token` loči veljavno verigo od stare (po spremembi intervala ali dvojnem zagonu stara sama umre).
	pollChain: defineTable({
		key: v.literal('main'),
		token: v.string(),
		nextAt: v.number()
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

	// Oprema iz igre (addon → Companion): Blizzard za Forever ne vrača več item levelov (lib/gameGear.ts).
	gameGear: defineTable({
		playerId: v.id('players'),
		ilvl: v.number(),
		ilvlBest: v.number(),
		items: v.array(v.object({ slot: v.number(), itemId: v.number(), ilvl: v.union(v.number(), v.null()) })),
		at: v.number()
	}).index('by_player', ['playerId']),

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
		.index('by_player_id_and_at', ['playerId', 'at'])
		.index('by_posted', ['postedAt']),

	// Nastavitve platforme (en dokument).
	settings: defineTable({
		key: v.literal('main'),
		pollIntervalSec: v.number(),
		publicFields: v.array(v.string()),
		/** kaj gre v Discord (objave + slash ukazi); manjka = vse */
		discordFields: v.optional(v.array(v.string())),
		paused: v.boolean(),
		/** realm druščine (WoW Forever: regija + ruleset); manjka = še ni izbran */
		realm: v.optional(v.object({ region: v.string(), ruleset: v.string(), since: v.number() })),
		/** zadnja verzija igre iz Blizzard static namespacea (dnevni cron; za predlog nove sezone) */
		gamePatch: v.optional(v.string())
	}).index('by_key', ['key']),

	// Novice na naslovnici: uradne WoW novice (dnevni cron, lib/news.ts) + objave druščine
	// (nova verzija igre, nova sezona, ročne objave Guild Mastra). Skrite ostanejo, da se ne vrnejo.
	news: defineTable({
		key: v.string(),
		source: v.union(v.literal('blizzard'), v.literal('company')),
		title: v.string(),
		summary: v.string(),
		url: v.optional(v.string()),
		image: v.optional(v.string()),
		publishedAt: v.number(),
		hidden: v.boolean()
	})
		.index('by_key', ['key'])
		.index('by_publishedAt', ['publishedAt'])
		.index('by_hidden_and_publishedAt', ['hidden', 'publishedAt']),

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
	// Imena/kakovost predmetov (lib/items.ts): po ID-ju (oprema) ali po imenu (loot iz chat loga).
	// Neuspeh se tudi zapiše (quality null), da se isti predmet ne išče znova.
	itemInfo: defineTable({
		itemId: v.union(v.number(), v.null()),
		name: v.string(),
		quality: v.union(v.number(), v.null()),
		at: v.number()
	})
		.index('by_itemId', ['itemId'])
		.index('by_name', ['name']),

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
	}).index('by_key', ['key']),

	// Število članov + čas osvežitve: admin dashboard bere samo to, ne celega rosterja.
	guildRosterMeta: defineTable({
		key: v.literal('main'),
		count: v.number(),
		fetchedAt: v.number()
	}).index('by_key', ['key']),

	// ---- WowCompany Companion (namizna aplikacija, glej COMPANION.md §7–8) ----

	// Povezane naprave. Žeton naprave hranimo samo kot SHA-256 (hex).
	devices: defineTable({
		userId: v.string(),
		name: v.string(),
		tokenHash: v.string(),
		appVersion: v.optional(v.string()),
		createdAt: v.number(),
		lastSeenAt: v.optional(v.number()),
		revokedAt: v.optional(v.number())
	})
		.index('by_token_hash', ['tokenHash'])
		.index('by_user', ['userId']),

	// Kratkotrajne zahteve za povezavo (koda v brskalniku, aplikacija polla s skrivnim pollHash).
	deviceLinks: defineTable({
		code: v.string(),
		pollHash: v.string(),
		status: linkStatus,
		deviceName: v.string(),
		appVersion: v.optional(v.string()),
		userId: v.optional(v.string()),
		createdAt: v.number(),
		expiresAt: v.number()
	})
		.index('by_code', ['code'])
		.index('by_poll_hash', ['pollHash'])
		.index('by_expires_at', ['expiresAt']),

	// Dungeon runi: majhen dokument za sezname (podrobnosti v runDetails).
	runs: defineTable({
		runKey: v.string(),
		schema: v.number(),
		zone,
		startedAt: v.number(),
		endedAt: v.number(),
		durationMs: v.number(),
		endReason,
		result: runResult,
		party: v.array(partyMember),
		recordedBy: v.array(recorder),
		/** ključ arhiva realma (glej archives) */
		archived: v.optional(v.string()),
		/** obstaja runReplay (da strani ni treba brati 50 KB dokumenta za gumb) */
		hasReplay: v.optional(v.boolean()),
		awards: v.array(award),
		/** vodja partyja (iz addona WowCompany prek Companiona); manjka, če ga nihče ni poslal */
		leader: v.optional(v.string()),
		/** število pobranih predmetov (za seznam; podrobnosti v runDetails.loot) */
		lootCount: v.optional(v.number()),
		/** popolnost posnetka – ob združevanju obdržimo boljšega */
		score: v.number(),
		/** kdaj je bil run objavljen v Discord (objava gre enkrat, 5 min po prvem uploadu) */
		discordPostedAt: v.optional(v.number()),
		/** član prosi za izbris runa; izbriše ga šele Guild Master (Office → Community → Petitions) */
		deleteRequest: v.optional(
			v.object({ userId: v.string(), name: v.string(), reason: v.string(), at: v.number() })
		),
		deleteRequestedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_run_key', ['runKey'])
		.index('by_started_at', ['startedAt'])
		.index('by_archived_and_started_at', ['archived', 'startedAt'])
		.index('by_delete_requested_at', ['deleteRequestedAt']),

	// Analiza runa (en dokument na run, ~5–100 KB; bere se samo na strani runa).
	runDetails: defineTable({
		runId: v.id('runs'),
		players: v.array(playerSummary),
		segments: v.array(segment),
		deaths: v.array(death),
		timeline,
		loot: v.optional(v.array(lootDrop)),
		rolls: v.optional(v.array(lootRoll)),
		combatMs: v.optional(v.number()),
		enemyHeals: v.optional(v.array(v.object({ name: v.string(), amount: v.number() })))
	}).index('by_run', ['runId']),

	// Podrobnosti predmetov iz igre (addon → Companion): item level, slot, stati … za tooltip na portalu.
	itemDetails: defineTable({ ...itemDetail.fields, at: v.number() }).index('by_itemId', ['itemId']),

	// Razčlenitev po boss boju (uroki, casti, tarče, uptime) – en dokument na boss; stran runa ga
	// prebere šele ob kliku na igralca, zato runDetails ostane majhen (DB I/O).
	runBossDetails: defineTable({
		runId: v.id('runs'),
		index: v.number(),
		players: v.array(bossDetailPlayer)
	}).index('by_run_and_index', ['runId', 'index']),

	// Koledar (lib/calendar.ts): prazniki iz igre (addon C_Calendar → Companion) in naši dogodki
	// (Guild Master). `going` = kdo pride (član + njegov glavni junak ob prijavi).
	calendarEvents: defineTable({
		source: v.union(v.literal('game'), v.literal('company')),
		key: v.string(),
		title: v.string(),
		description: v.string(),
		kind: v.string(),
		startAt: v.number(),
		endAt: v.number(),
		location: v.optional(v.string()),
		createdBy: v.optional(v.string()),
		going: v.optional(
			v.array(v.object({ userId: v.string(), name: v.string(), slug: v.optional(v.string()) }))
		),
		/** naš dogodek: objavi v Discord (ob shranjevanju) + opomnik uro prej */
		discord: v.optional(v.boolean()),
		announcedAt: v.optional(v.number()),
		remindedAt: v.optional(v.number()),
		reminderJob: v.optional(v.id('_scheduled_functions')),
		updatedAt: v.number()
	})
		.index('by_key', ['key'])
		.index('by_startAt', ['startAt'])
		.index('by_source_and_startAt', ['source', 'startAt']),

	// Vsebina naslovnice (lib/siteContent.ts): šale junakov in povezave na skupnost. Svoj dokument,
	// da settings (bere ga skoraj vsaka poizvedba) ostane majhen.
	siteContent: defineTable({
		key: v.literal('main'),
		quips: v.array(v.string()),
		convos: v.array(v.array(v.string())),
		socials: v.array(
			v.object({ kind: v.string(), url: v.string(), label: v.optional(v.string()) })
		),
		/** ime ekipe pred "WowCompany" v glavi strani (npr. "Ajmer Central") */
		teamName: v.optional(v.string()),
		/** vrste dogodkov v "Coming up" na naslovnici (lib/calendar.ts); manjka = samo naši */
		homeEventKinds: v.optional(v.array(v.string()))
	}).index('by_key', ['key']),

	// Diagnostika addona (opt-in v addonu, pošlje Companion): tehnično poročilo brez imen, za razvoj.
	// Največ 3 na napravo (starejša se izbrišejo). Vidi samo Guild Master (System → Diagnostics).
	diagnostics: defineTable({
		deviceId: v.id('devices'),
		userId: v.string(),
		addonVersion: v.string(),
		appVersion: v.string(),
		at: v.number(),
		receivedAt: v.number(),
		/** JSON besedilo poročila (≤ 100 KB) */
		report: v.string()
	})
		.index('by_device_and_at', ['deviceId', 'at'])
		.index('by_receivedAt', ['receivedAt']),

	// Zemljevid dungeona za replay: posnetek zaslona igrine karte (M), ki ga Guild Master naloži in
	// poravna s potmi partyja. `align` v jardih zaslonskih koordinat replaya (vzhod desno, sever gor).
	dungeonMaps: defineTable({
		instanceId: v.number(),
		zone: v.string(),
		storageId: v.id('_storage'),
		/** razmerje širina/višina slike */
		aspect: v.number(),
		align: v.object({ x: v.number(), y: v.number(), width: v.number(), rotate: v.number() }),
		updatedAt: v.number()
	}).index('by_instance', ['instanceId']),

	// Arhivi realmov: ko druščina zamenja realm, se junaki, runi in sezone starega realma označijo
	// s `key` (samo branje za člane, /archive). Vrnitev v 30 dneh jih obnovi, potem jih cron izbriše.
	archives: defineTable({
		key: v.string(),
		region: v.string(),
		ruleset: v.string(),
		archivedAt: v.number(),
		deleteAt: v.number(),
		heroes: v.number(),
		runs: v.number(),
		/** brisanje teče (cron v paketih) */
		purging: v.optional(v.boolean())
	})
		.index('by_key', ['key'])
		.index('by_deleteAt', ['deleteAt']),

	// Replay runa: pozicije partyja (en dokument na run, ~50 KB) – bere se samo ob odprtem zavihku Replay.
	runReplay: defineTable({ runId: v.id('runs'), ...replay.fields }).index('by_run', ['runId']),

	// Vseživljenjski rekordi spremljanih junakov (največji crit …): ena vrstica na junaka in vrsto.
	// Posodobi jih ingestRun, ko run prinese večjo številko. Vidnost: polje 'runDetails'.
	heroRecords: defineTable({
		slug: v.string(),
		kind: recordKind,
		amount: v.number(),
		spell: v.string(),
		spellId: v.number(),
		unit: v.union(v.string(), v.null()),
		pet: v.boolean(),
		/** run, iz katerega je rekord; manjka pri rekordih iz celega loga (open world) */
		runId: v.optional(v.id('runs')),
		/** dungeon ali cona; pri open worldu je lahko neznana */
		zone: v.union(v.string(), v.null()),
		/** true = zunaj dungeon runa (osebni rekordi iz /companion/records) */
		world: v.optional(v.boolean()),
		at: v.number()
	})
		.index('by_slug_and_kind', ['slug', 'kind'])
		.index('by_kind_and_amount', ['kind', 'amount'])
		.index('by_run', ['runId']),

	// Company Parses (docs/STATS.md §6): en boss kill × spremljan junak. Majhne vrstice (~250 B);
	// percentil se izračuna ob branju proti drugim iz iste skupine (boss + težavnost + vloga + sezona).
	parses: defineTable({
		runId: v.id('runs'),
		slug: v.string(),
		playerId: v.id('players'),
		encounterId: v.number(),
		encounter: v.string(),
		zone: v.string(),
		difficultyId: v.number(),
		role: v.union(v.literal('dps'), v.literal('heal'), v.literal('tank')),
		dps: v.number(),
		hps: v.number(),
		taken: v.number(),
		durationMs: v.number(),
		ilvl: v.union(v.number(), v.null()),
		/** UTC ms konca boja */
		at: v.number(),
		season: v.number()
	})
		.index('by_encounterId_and_difficultyId_and_role_and_season', [
			'encounterId',
			'difficultyId',
			'role',
			'season'
		])
		.index('by_slug_and_season', ['slug', 'season'])
		.index('by_season', ['season'])
		.index('by_run', ['runId']),

	// Najboljši parse vsakega junaka v skupini (boss + težavnost + vloga + sezona) – en majhen dokument
	// na skupino. Logs in Rankings berejo te namesto vseh parsov (DB I/O). Vzdržuje lib/pools.ts.
	parsePools: defineTable({
		encounterId: v.number(),
		difficultyId: v.number(),
		role: v.union(v.literal('dps'), v.literal('heal'), v.literal('tank')),
		season: v.number(),
		encounter: v.string(),
		zone: v.string(),
		entries: v.array(
			v.object({
				slug: v.string(),
				value: v.number(),
				runId: v.id('runs'),
				at: v.number(),
				ilvl: v.union(v.number(), v.null()),
				durationMs: v.number()
			})
		)
	})
		.index('by_encounterId_and_difficultyId_and_role_and_season', [
			'encounterId',
			'difficultyId',
			'role',
			'season'
		])
		.index('by_season', ['season']),

	// Pridobitve snemalca v runu (XP, denar, reputacija, veščine) – ena vrstica na run in snemalca.
	runProgress: defineTable({
		runId: v.id('runs'),
		slug: v.string(),
		zone: v.string(),
		startedAt: v.number(),
		durationMs: v.number(),
		season: v.number(),
		xp: v.number(),
		xpBonus: v.number(),
		copper: v.number(),
		reputation: v.array(v.object({ faction: v.string(), amount: v.number() })),
		skills: v.array(v.object({ skill: v.string(), from: v.number(), to: v.number() })),
		levels: v.array(v.number()),
		castFails: v.optional(castFails)
	})
		.index('by_run_and_slug', ['runId', 'slug'])
		.index('by_season', ['season']),

	// Celotni cleari (za "Speed demons"): majhna vrstica na run, da Rankings ne bere celih runov.
	clears: defineTable({
		runId: v.id('runs'),
		season: v.number(),
		zone: v.string(),
		durationMs: v.number(),
		startedAt: v.number(),
		deaths: v.number(),
		party: v.array(v.object({ slug: v.string(), name: v.string() }))
	})
		.index('by_season_and_zone_and_durationMs', ['season', 'zone', 'durationMs'])
		.index('by_run', ['runId']),

	// Sezone (particije lestvic): nova ob večjem patchu, ko jo potrdi admin. Brez vrstic = Season 1.
	seasons: defineTable({
		number: v.number(),
		name: v.string(),
		startedAt: v.number(),
		/** verzija igre ob začetku (npr. "1.61.0"), če je znana */
		patch: v.union(v.string(), v.null()),
		/** ključ arhiva realma: sezona starega realma (lestvica ostane berljiva v arhivu) */
		archived: v.optional(v.string())
	})
		.index('by_number', ['number'])
		.index('by_startedAt', ['startedAt']),

	// Kdo je bil v runu (za zavihek Runs na strani junaka).
	runParticipants: defineTable({
		runId: v.id('runs'),
		slug: v.string(),
		playerId: v.optional(v.id('players')),
		startedAt: v.number()
	})
		.index('by_run', ['runId'])
		.index('by_slug_and_started_at', ['slug', 'startedAt'])
});
