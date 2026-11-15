// WowCompany Companion: povezava naprave, objava runov (COMPANION.md §7–8).
// HTTP vstopne točke so v companionHttp.ts; tu so mutacije/poizvedbe.
import { HOUR, MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api.js';
import type { Doc, Id } from './_generated/dataModel.js';
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server.js';
import { getViewer } from './lib/access.js';
import { itemById, itemByName, itemIcon, mapLimit } from './lib/blizzard.js';
import {
	addRecorder,
	beatsRecord,
	checkPersonal,
	checkRun,
	computeAwards,
	LINK_TTL_MS,
	normalizeCode,
	runScore,
	splitBossDetails
} from './lib/companion.js';
import {
	personalUpload,
	runSummary,
	type BossDetailPlayer,
	type RunSummary
} from './lib/companionSchema.js';
import { parseRows } from './lib/parses.js';
import { updatePools, writeClear } from './lib/pools.js';
import { seasonAt } from './seasons.js';

const limiter = new RateLimiter(components.rateLimiter, {
	// Cela platforma: največ 30 novih povezav na uro (prijateljska skupina).
	companionLinkStart: { kind: 'fixed window', rate: 30, period: HOUR },
	// Na povezavo: aplikacija polla vsake ~3 s.
	companionLinkPoll: { kind: 'token bucket', rate: 40, period: MINUTE, capacity: 10 },
	// Na napravo: ~1 run na 2 min v povprečju, do 10 naenkrat (čakalna vrsta po izpadu interneta).
	companionUpload: { kind: 'token bucket', rate: 30, period: HOUR, capacity: 10 },
	// Na napravo: osebni rekordi (aplikacija jih pošlje največ enkrat na minuto, samo ob novem rekordu).
	companionRecords: { kind: 'token bucket', rate: 60, period: HOUR, capacity: 10 }
});

/** Napaka, ki jo HTTP plast pretvori v statusno kodo. */
function fail(
	code: 'bad_request' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'retry',
	message: string,
	retryAfter?: number
): never {
	throw new ConvexError({ code, message, retryAfter: retryAfter ?? null });
}

async function roleOf(ctx: QueryCtx, userId: string) {
	const doc = await ctx.db
		.query('roles')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.unique();
	return doc?.role ?? null;
}

async function requireMemberViewer(ctx: QueryCtx) {
	const viewer = await getViewer(ctx);
	if (!viewer) throw new ConvexError('Sign in first.');
	if (viewer.role !== 'admin' && viewer.role !== 'member')
		throw new ConvexError('Members only. Petition the Guild Master first.');
	return viewer;
}

// ---------------------------------------------------------------- povezava naprave

export const startLink = internalMutation({
	args: {
		code: v.string(),
		pollHash: v.string(),
		deviceName: v.string(),
		appVersion: v.optional(v.string())
	},
	returns: v.object({ expiresAt: v.number() }),
	handler: async (ctx, args) => {
		const now = Date.now();
		const taken = await ctx.db
			.query('deviceLinks')
			.withIndex('by_code', (q) => q.eq('code', args.code))
			.order('desc')
			.first();
		if (taken && taken.expiresAt > now) fail('retry', 'code collision');
		const rl = await limiter.limit(ctx, 'companionLinkStart');
		if (!rl.ok) fail('rate_limited', 'Too many link requests. Try again later.', rl.retryAfter);
		const expiresAt = now + LINK_TTL_MS;
		await ctx.db.insert('deviceLinks', {
			code: args.code,
			pollHash: args.pollHash,
			status: 'pending',
			deviceName: args.deviceName.slice(0, 64),
			appVersion: args.appVersion?.slice(0, 32),
			createdAt: now,
			expiresAt
		});
		return { expiresAt };
	}
});

/** Aplikacija polla. Ob odobritvi ustvari napravo s podanim hashom žetona (žeton pozna samo HTTP plast). */
export const pollLink = internalMutation({
	args: { pollHash: v.string(), tokenHash: v.string() },
	returns: v.union(
		v.object({ status: v.literal('pending'), expiresAt: v.number() }),
		v.object({ status: v.literal('approved'), deviceId: v.id('devices') }),
		v.object({
			status: v.union(
				v.literal('denied'),
				v.literal('expired'),
				v.literal('claimed'),
				v.literal('unknown')
			)
		})
	),
	handler: async (ctx, { pollHash, tokenHash }) => {
		const rl = await limiter.limit(ctx, 'companionLinkPoll', { key: pollHash });
		if (!rl.ok) fail('rate_limited', 'Slow down.', rl.retryAfter);
		const link = await ctx.db
			.query('deviceLinks')
			.withIndex('by_poll_hash', (q) => q.eq('pollHash', pollHash))
			.unique();
		if (!link) return { status: 'unknown' as const };
		const now = Date.now();
		if (link.status === 'pending') {
			return link.expiresAt > now
				? { status: 'pending' as const, expiresAt: link.expiresAt }
				: { status: 'expired' as const };
		}
		if (link.status !== 'approved') return { status: link.status };
		if (!link.userId || link.expiresAt + LINK_TTL_MS < now) return { status: 'expired' as const };
		const role = await roleOf(ctx, link.userId);
		if (role !== 'admin' && role !== 'member') return { status: 'denied' as const };
		const deviceId = await ctx.db.insert('devices', {
			userId: link.userId,
			name: link.deviceName,
			tokenHash,
			appVersion: link.appVersion,
			createdAt: now
		});
		await ctx.db.patch('deviceLinks', link._id, { status: 'claimed' });
		return { status: 'approved' as const, deviceId };
	}
});

/** Za stran /link: kaj se povezuje. `now` pošlje brskalnik (poizvedbe ne berejo ure). */
export const linkInfo = query({
	args: { code: v.string(), now: v.number() },
	returns: v.union(
		v.null(),
		v.object({
			deviceName: v.string(),
			status: v.string(),
			expired: v.boolean(),
			appVersion: v.union(v.string(), v.null())
		})
	),
	handler: async (ctx, { code, now }) => {
		const viewer = await getViewer(ctx);
		if (!viewer) return null;
		const link = await ctx.db
			.query('deviceLinks')
			.withIndex('by_code', (q) => q.eq('code', normalizeCode(code)))
			.order('desc')
			.first();
		if (!link) return null;
		return {
			deviceName: link.deviceName,
			status: link.status,
			expired: link.status === 'pending' && link.expiresAt <= now,
			appVersion: link.appVersion ?? null
		};
	}
});

export const decideLink = mutation({
	args: { code: v.string(), approve: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { code, approve }) => {
		const viewer = await requireMemberViewer(ctx);
		const link = await ctx.db
			.query('deviceLinks')
			.withIndex('by_code', (q) => q.eq('code', normalizeCode(code)))
			.order('desc')
			.first();
		if (!link || link.status !== 'pending')
			throw new ConvexError('This code is dead. Get a fresh one from the app.');
		if (link.expiresAt <= Date.now()) throw new ConvexError('Code expired. Like your buffs.');
		await ctx.db.patch('deviceLinks', link._id, {
			status: approve ? 'approved' : 'denied',
			userId: viewer.user._id
		});
		return null;
	}
});

export const myDevices = query({
	args: {},
	returns: v.array(
		v.object({
			_id: v.id('devices'),
			name: v.string(),
			appVersion: v.union(v.string(), v.null()),
			createdAt: v.number(),
			lastSeenAt: v.union(v.number(), v.null()),
			revokedAt: v.union(v.number(), v.null())
		})
	),
	handler: async (ctx) => {
		const viewer = await getViewer(ctx);
		if (!viewer) return [];
		const list = await ctx.db
			.query('devices')
			.withIndex('by_user', (q) => q.eq('userId', viewer.user._id))
			.order('desc')
			.take(50);
		return list.map((d) => ({
			_id: d._id,
			name: d.name,
			appVersion: d.appVersion ?? null,
			createdAt: d.createdAt,
			lastSeenAt: d.lastSeenAt ?? null,
			revokedAt: d.revokedAt ?? null
		}));
	}
});

export const revokeDevice = mutation({
	args: { deviceId: v.id('devices') },
	returns: v.null(),
	handler: async (ctx, { deviceId }) => {
		const viewer = await getViewer(ctx);
		if (!viewer) throw new ConvexError('Sign in first.');
		const device = await ctx.db.get('devices', deviceId);
		if (!device) throw new ConvexError('No such device.');
		if (device.userId !== viewer.user._id && viewer.role !== 'admin')
			throw new ConvexError('Not your device.');
		if (!device.revokedAt) await ctx.db.patch('devices', deviceId, { revokedAt: Date.now() });
		return null;
	}
});

// ---------------------------------------------------------------- objava runa

async function partyFor(ctx: MutationCtx, s: RunSummary) {
	return Promise.all(
		s.players.map(async (p) => {
			const player = await ctx.db
				.query('players')
				.withIndex('by_slug', (q) => q.eq('slug', p.slug))
				.first();
			return {
				slug: p.slug,
				name: p.name,
				...(player ? { playerId: player._id } : {}),
				damage: p.damage,
				healing: p.healing,
				deaths: p.deaths
			};
		})
	);
}

/**
 * Vseživljenjski rekordi: samo za spremljane junake (playerId) in samo, če run prinese večjo številko.
 * Največ 5 vrstic na igralca -> ≤ 50 branj na run.
 */
async function writeHeroRecords(
	ctx: MutationCtx,
	runId: Id<'runs'>,
	s: RunSummary,
	party: { slug: string; playerId?: Id<'players'> }[]
) {
	const tracked = new Set(party.filter((p) => p.playerId).map((p) => p.slug));
	for (const p of s.players) {
		if (!tracked.has(p.slug)) continue;
		for (const r of p.records ?? []) {
			const prev = await ctx.db
				.query('heroRecords')
				.withIndex('by_slug_and_kind', (q) => q.eq('slug', p.slug).eq('kind', r.kind))
				.unique();
			if (!beatsRecord(prev, r)) continue;
			const row = {
				slug: p.slug,
				kind: r.kind,
				amount: r.amount,
				spell: r.spell,
				spellId: r.spellId,
				unit: r.unit,
				pet: r.pet,
				runId,
				zone: s.zone.name,
				at: s.startedAt + r.atMs
			};
			if (prev) await ctx.db.replace('heroRecords', prev._id, row);
			else await ctx.db.insert('heroRecords', row);
		}
	}
}

/**
 * Isti run z drugim ključem: druga verzija aplikacije (popravek uid kopije instance, 15. 11. 2026) ali
 * drug snemalec brez creature GUID-ov. Isti dungeon, začetek v ±10 min, vsaj dva skupna igralca
 * (oziroma vsi, če jih je manj). Bere ≤ 20 runov iz okna.
 */
async function sameRunWithOtherKey(ctx: MutationCtx, s: RunSummary) {
	const near = await ctx.db
		.query('runs')
		.withIndex('by_started_at', (q) =>
			q.gte('startedAt', s.startedAt - 10 * 60_000).lte('startedAt', s.startedAt + 10 * 60_000)
		)
		.take(20);
	const mine = new Set(s.players.map((p) => p.slug));
	return (
		near.find((r) => {
			if (r.zone.instanceId !== s.zone.instanceId) return false;
			const shared = r.party.filter((p) => mine.has(p.slug)).length;
			return shared >= Math.min(2, mine.size, r.party.length);
		}) ?? null
	);
}

/** Company Parses tega runa: najprej pobriše stare (boljši posnetek istega runa jih zamenja). */
async function writeParses(
	ctx: MutationCtx,
	runId: Id<'runs'>,
	s: RunSummary,
	party: { slug: string; name?: string; playerId?: Id<'players'>; deaths?: number }[]
) {
	const removed: Doc<'parses'>[] = [];
	for await (const old of ctx.db.query('parses').withIndex('by_run', (q) => q.eq('runId', runId))) {
		removed.push(old);
		await ctx.db.delete('parses', old._id);
	}
	const ids = new Map(party.filter((p) => p.playerId).map((p) => [p.slug, p.playerId!]));
	const added: Doc<'parses'>[] = [];
	for (const row of parseRows(s, new Set(ids.keys()))) {
		const doc = {
			...row,
			runId,
			playerId: ids.get(row.slug)!,
			season: await seasonAt(ctx, row.at)
		};
		const id = await ctx.db.insert('parses', doc);
		added.push({ ...doc, _id: id, _creationTime: Date.now() });
	}
	await updatePools(ctx, removed, added);
	await writeClear(
		ctx,
		runId,
		s,
		party.map((p) => ({ slug: p.slug, name: p.name ?? p.slug, deaths: p.deaths ?? 0 })),
		await seasonAt(ctx, s.endedAt)
	);
}

/** Pridobitve snemalca: ena vrstica na run in snemalca (drugi snemalec istega runa doda svojo). */
async function writeProgress(ctx: MutationCtx, runId: Id<'runs'>, s: RunSummary) {
	if (!s.progress || !s.recorder) return;
	const row = {
		runId,
		slug: s.recorder,
		zone: s.zone.name,
		startedAt: s.startedAt,
		durationMs: s.durationMs,
		season: await seasonAt(ctx, s.endedAt),
		...s.progress
	};
	const old = await ctx.db
		.query('runProgress')
		.withIndex('by_run_and_slug', (q) => q.eq('runId', runId).eq('slug', row.slug))
		.unique();
	if (old) await ctx.db.replace('runProgress', old._id, row);
	else await ctx.db.insert('runProgress', row);
}

async function writeBossDetails(
	ctx: MutationCtx,
	runId: Id<'runs'>,
	details: { index: number; players: BossDetailPlayer[] }[]
) {
	for await (const old of ctx.db
		.query('runBossDetails')
		.withIndex('by_run_and_index', (q) => q.eq('runId', runId))) {
		await ctx.db.delete('runBossDetails', old._id);
	}
	for (const d of details) await ctx.db.insert('runBossDetails', { runId, ...d });
}

async function writeParticipants(
	ctx: MutationCtx,
	runId: Id<'runs'>,
	party: { slug: string; playerId?: Id<'players'> }[],
	startedAt: number
) {
	for await (const old of ctx.db
		.query('runParticipants')
		.withIndex('by_run', (q) => q.eq('runId', runId))) {
		await ctx.db.delete('runParticipants', old._id);
	}
	for (const p of party) {
		await ctx.db.insert('runParticipants', {
			runId,
			slug: p.slug,
			...(p.playerId ? { playerId: p.playerId } : {}),
			startedAt
		});
	}
}

/** En klic na upload: žeton → naprava → članstvo → validacija → združevanje po runKey. */
export const ingestRun = internalMutation({
	args: { tokenHash: v.string(), summary: runSummary },
	returns: v.object({
		runId: v.id('runs'),
		created: v.boolean(),
		recorderAdded: v.boolean(),
		replaced: v.boolean()
	}),
	handler: async (ctx, { tokenHash, summary: s }) => {
		const device = await ctx.db
			.query('devices')
			.withIndex('by_token_hash', (q) => q.eq('tokenHash', tokenHash))
			.unique();
		if (!device) fail('unauthorized', 'Unknown device. Link the app again.');
		if (device.revokedAt) fail('forbidden', 'This device was revoked.');
		const role = await roleOf(ctx, device.userId);
		if (role !== 'admin' && role !== 'member') fail('forbidden', 'Members only.');

		const now = Date.now();
		const problem = checkRun(s, now);
		if (problem) fail('bad_request', problem);

		const rl = await limiter.limit(ctx, 'companionUpload', { key: device._id });
		if (!rl.ok) fail('rate_limited', 'Too many uploads.', rl.retryAfter);

		await ctx.db.patch('devices', device._id, { lastSeenAt: now });

		const rec = { userId: device.userId, deviceId: device._id, slug: s.recorder, at: now };
		const score = runScore(s);
		const existing =
			(await ctx.db
				.query('runs')
				.withIndex('by_run_key', (q) => q.eq('runKey', s.runKey))
				.first()) ?? (await sameRunWithOtherKey(ctx, s));

		const loot = s.loot ?? [];
		const rolls = s.rolls ?? [];
		// razčlenitev po bossih v ločene dokumente (bere se ob kliku), segmenti ostanejo majhni
		const split = splitBossDetails(s.segments);
		const details = {
			players: s.players,
			segments: split.slim,
			deaths: s.deaths,
			timeline: s.timeline,
			loot,
			...(rolls.length ? { rolls } : {})
		};
		const runFields = {
			schema: s.schema,
			zone: s.zone,
			startedAt: s.startedAt,
			endedAt: s.endedAt,
			durationMs: s.durationMs,
			endReason: s.endReason,
			result: s.result,
			awards: computeAwards(s.players, loot),
			lootCount: loot.reduce((n, l) => n + l.count, 0),
			score,
			// vodjo pozna samo addon; posnetek brez addona ga ne sme izbrisati
			...(s.leader ? { leader: s.leader } : {})
		};

		if (!existing) {
			const party = await partyFor(ctx, s);
			const runId = await ctx.db.insert('runs', {
				runKey: s.runKey,
				...runFields,
				party,
				recordedBy: [rec],
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('runDetails', { runId, ...details });
			await writeBossDetails(ctx, runId, split.details);
			await writeParticipants(ctx, runId, party, s.startedAt);
			await writeHeroRecords(ctx, runId, s, party);
			await writeParses(ctx, runId, s, party);
			await writeProgress(ctx, runId, s);
			// Discord: enkrat, čez 5 min (drugi snemalec, dopolnitev iz addona); postRun preveri vidnost
			await ctx.scheduler.runAfter(5 * 60_000, internal.discord.postRun, { runId });
			await ctx.scheduler.runAfter(0, internal.companion.enrichItems, { runId });
			return { runId, created: true, recorderAdded: true, replaced: false };
		}

		const { list: recordedBy, added } = addRecorder(existing.recordedBy, rec);
		// boljši posnetek; pri enaki oceni tudi novejša shema (posodobljena aplikacija prinese več podrobnosti)
		const better =
			score > existing.score || (score === existing.score && s.schema > existing.schema);
		if (better) {
			const party = await partyFor(ctx, s);
			await ctx.db.patch('runs', existing._id, { ...runFields, party, recordedBy, updatedAt: now });
			const old = await ctx.db
				.query('runDetails')
				.withIndex('by_run', (q) => q.eq('runId', existing._id))
				.unique();
			if (old) await ctx.db.replace('runDetails', old._id, { runId: existing._id, ...details });
			else await ctx.db.insert('runDetails', { runId: existing._id, ...details });
			await writeBossDetails(ctx, existing._id, split.details);
			await writeParticipants(ctx, existing._id, party, s.startedAt);
			await writeHeroRecords(ctx, existing._id, s, party);
			await writeParses(ctx, existing._id, s, party);
			await ctx.scheduler.runAfter(0, internal.companion.enrichItems, { runId: existing._id });
		} else {
			// isti posnetek z več podatki o lootu (ID/kakovost iz addona pride pozno) ali z rolli
			// (novejša aplikacija): zamenjaj samo to
			const known = (l: { quality: number | null; itemId: number | null }[]) =>
				l.filter((x) => x.quality !== null || x.itemId !== null).length;
			if (known(loot) > 0 || rolls.length > 0) {
				const old = await ctx.db
					.query('runDetails')
					.withIndex('by_run', (q) => q.eq('runId', existing._id))
					.unique();
				const oldLoot = old?.loot ?? [];
				const oldRolls = old?.rolls ?? [];
				const patch: { loot?: typeof loot; rolls?: typeof rolls } = {};
				if (oldLoot.length === loot.length && known(loot) > known(oldLoot)) patch.loot = loot;
				if (
					rolls.length > oldRolls.length ||
					(rolls.length === oldRolls.length && known(rolls) > known(oldRolls))
				)
					patch.rolls = rolls;
				if (old && (patch.loot || patch.rolls)) await ctx.db.patch('runDetails', old._id, patch);
			}
		}
		if (!better && (added || (s.leader && !existing.leader))) {
			// slabši/enak posnetek lahko še vedno prinese snemalca ali vodjo (addon pride pozno, ob /reload)
			await ctx.db.patch('runs', existing._id, {
				recordedBy,
				updatedAt: now,
				...(s.leader && !existing.leader ? { leader: s.leader } : {})
			});
		}
		// pridobitve snemalca vedno (vsak snemalec ima svoje), tudi ko posnetek ni boljši
		await writeProgress(ctx, existing._id, s);
		return { runId: existing._id, created: false, recorderAdded: added, replaced: better };
	}
});

/**
 * Osebni rekordi iz celega combat loga (tudi open world), POST /companion/records.
 * Samo za spremljane junake, ki niso last drugega uporabnika; zapiše se le večja številka.
 */
export const ingestPersonal = internalMutation({
	args: { tokenHash: v.string(), upload: personalUpload },
	returns: v.object({ updated: v.number(), ignored: v.array(v.string()) }),
	handler: async (ctx, { tokenHash, upload }) => {
		const device = await ctx.db
			.query('devices')
			.withIndex('by_token_hash', (q) => q.eq('tokenHash', tokenHash))
			.unique();
		if (!device) fail('unauthorized', 'Unknown device. Link the app again.');
		if (device.revokedAt) fail('forbidden', 'This device was revoked.');
		const role = await roleOf(ctx, device.userId);
		if (role !== 'admin' && role !== 'member') fail('forbidden', 'Members only.');

		const now = Date.now();
		const problem = checkPersonal(upload, now);
		if (problem) fail('bad_request', problem);

		const rl = await limiter.limit(ctx, 'companionRecords', { key: device._id });
		if (!rl.ok) fail('rate_limited', 'Too many record uploads.', rl.retryAfter);

		let updated = 0;
		const ignored: string[] = [];
		for (const c of upload.characters) {
			const player = await ctx.db
				.query('players')
				.withIndex('by_slug', (q) => q.eq('slug', c.slug))
				.first();
			// neznan junak ali junak drugega uporabnika: ne zapišemo ničesar
			if (!player || (player.ownerUserId && player.ownerUserId !== device.userId)) {
				ignored.push(c.slug);
				continue;
			}
			for (const r of c.records) {
				const prev = await ctx.db
					.query('heroRecords')
					.withIndex('by_slug_and_kind', (q) => q.eq('slug', c.slug).eq('kind', r.kind))
					.unique();
				if (!beatsRecord(prev, r)) continue;
				const row = {
					slug: c.slug,
					kind: r.kind,
					amount: r.amount,
					spell: r.spell,
					spellId: r.spellId,
					unit: r.unit,
					pet: false,
					zone: r.zone,
					world: !r.inDungeon,
					at: r.at
				};
				if (prev) await ctx.db.replace('heroRecords', prev._id, row);
				else await ctx.db.insert('heroRecords', row);
				updated++;
			}
		}
		return { updated, ignored };
	}
});

// ---------------------------------------------------------------- vzdrževanje

/** Cron: pobriši zahteve za povezavo, starejše od 1 dneva. */
export const cleanupLinks = internalMutation({
	args: {},
	returns: v.number(),
	handler: async (ctx) => {
		const cutoff = Date.now() - 86_400_000;
		const old = await ctx.db
			.query('deviceLinks')
			.withIndex('by_expires_at', (q) => q.lt('expiresAt', cutoff))
			.take(200);
		for (const l of old) await ctx.db.delete('deviceLinks', l._id);
		return old.length;
	}
});

/** Admin/CLI: izbriši run z vsemi podatki (`bunx convex run companion:deleteRun '{"runId":"…"}'`). */
export const deleteRun = internalMutation({
	args: { runId: v.id('runs') },
	returns: v.null(),
	handler: async (ctx, { runId }) => {
		for await (const p of ctx.db
			.query('runParticipants')
			.withIndex('by_run', (q) => q.eq('runId', runId))) {
			await ctx.db.delete('runParticipants', p._id);
		}
		for await (const d of ctx.db
			.query('runDetails')
			.withIndex('by_run', (q) => q.eq('runId', runId))) {
			await ctx.db.delete('runDetails', d._id);
		}
		// rekordi iz tega runa izginejo z njim (prejšnji rekord junaka se ne obnovi – pride z naslednjim runom)
		for await (const r of ctx.db
			.query('heroRecords')
			.withIndex('by_run', (q) => q.eq('runId', runId))) {
			await ctx.db.delete('heroRecords', r._id);
		}
		const removed: Doc<'parses'>[] = [];
		for await (const p of ctx.db.query('parses').withIndex('by_run', (q) => q.eq('runId', runId))) {
			removed.push(p);
			await ctx.db.delete('parses', p._id);
		}
		await updatePools(ctx, removed, []);
		for await (const b of ctx.db
			.query('runBossDetails')
			.withIndex('by_run_and_index', (q) => q.eq('runId', runId))) {
			await ctx.db.delete('runBossDetails', b._id);
		}
		for await (const c of ctx.db.query('clears').withIndex('by_run', (q) => q.eq('runId', runId))) {
			await ctx.db.delete('clears', c._id);
		}
		for await (const g of ctx.db
			.query('runProgress')
			.withIndex('by_run_and_slug', (q) => q.eq('runId', runId))) {
			await ctx.db.delete('runProgress', g._id);
		}
		if (await ctx.db.get('runs', runId)) await ctx.db.delete('runs', runId);
		return null;
	}
});

/**
 * Enkratno/CLI: parse za že naložene rune (pred Company Parses). Po straneh, da ostane v mejah
 * ene transakcije: `bunx convex run [--prod] companion:backfillParses '{}'` (nadaljuje sama).
 */
export const backfillParses = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db.query('runs').paginate({ numItems: 20, cursor: cursor ?? null });
		let written = 0;
		for (const run of page.page) {
			const details = await ctx.db
				.query('runDetails')
				.withIndex('by_run', (q) => q.eq('runId', run._id))
				.unique();
			if (!details) continue;
			const s = { ...run, segments: details.segments } as unknown as RunSummary;
			await writeParses(ctx, run._id, s, run.party);
			written += 1;
		}
		if (!page.isDone)
			await ctx.scheduler.runAfter(0, internal.companion.backfillParses, {
				cursor: page.continueCursor
			});
		return { runs: written, done: page.isDone };
	}
});

/** CLI/test: pobriši rekorde junaka, ki niso iz runa (osebni rekordi iz celega loga). */
export const deleteWorldRecords = internalMutation({
	args: { slug: v.string() },
	returns: v.number(),
	handler: async (ctx, { slug }) => {
		let n = 0;
		for await (const r of ctx.db
			.query('heroRecords')
			.withIndex('by_slug_and_kind', (q) => q.eq('slug', slug))) {
			if (r.runId) continue;
			await ctx.db.delete('heroRecords', r._id);
			n++;
		}
		return n;
	}
});

/** CLI/test: odobri povezavo v imenu uporabnika (ni javno dosegljivo). */
export const approveLinkAs = internalMutation({
	args: { code: v.string(), userId: v.string() },
	returns: v.null(),
	handler: async (ctx, { code, userId }) => {
		const link = await ctx.db
			.query('deviceLinks')
			.withIndex('by_code', (q) => q.eq('code', normalizeCode(code)))
			.order('desc')
			.first();
		if (!link || link.status !== 'pending') throw new ConvexError('no pending link');
		await ctx.db.patch('deviceLinks', link._id, { status: 'approved', userId });
		return null;
	}
});

/** CLI/test: izbriši napravo. */
export const deleteDevice = internalMutation({
	args: { deviceId: v.id('devices') },
	returns: v.null(),
	handler: async (ctx, { deviceId }) => {
		if (await ctx.db.get('devices', deviceId)) await ctx.db.delete('devices', deviceId);
		return null;
	}
});

// ------------------------------------------------------------------ predmeti: ikone, imena, kakovost

/** Kaj o predmetih runa še manjka v cacheu (ikone in imena opreme, kakovost lootu po imenu). */
export const itemWork = internalQuery({
	args: { runId: v.id('runs'), now: v.number() },
	handler: async (ctx, { runId, now }) => {
		// neuspeh se ponovno poskusi po tednu (pravila iskanja se lahko izboljšajo)
		const fresh = (hit: { quality: number | null; at: number } | null) =>
			!!hit && (hit.quality !== null || now - hit.at < 7 * 86_400_000);
		const d = await ctx.db
			.query('runDetails')
			.withIndex('by_run', (q) => q.eq('runId', runId))
			.unique();
		const gearIds = [
			...new Set((d?.players ?? []).flatMap((p) => (p.gear ?? []).map((g) => g.itemId)))
		];
		const icons: number[] = [];
		const ids: number[] = [];
		for (const itemId of gearIds) {
			if (
				!(await ctx.db
					.query('itemIcons')
					.withIndex('by_item', (q) => q.eq('itemId', itemId))
					.first())
			)
				icons.push(itemId);
			const info = await ctx.db
				.query('itemInfo')
				.withIndex('by_itemId', (q) => q.eq('itemId', itemId))
				.first();
			if (!fresh(info)) ids.push(itemId);
		}
		const lootNames = [
			...new Set([
				...(d?.loot ?? []).filter((l) => l.quality === null).map((l) => l.item),
				...(d?.rolls ?? []).filter((r) => r.quality === null).map((r) => r.item)
			])
		];
		const names: string[] = [];
		for (const name of lootNames) {
			const info = await ctx.db
				.query('itemInfo')
				.withIndex('by_name', (q) => q.eq('name', name))
				.first();
			if (!fresh(info)) names.push(name);
		}
		return { icons: icons.slice(0, 100), ids: ids.slice(0, 100), names: names.slice(0, 150) };
	}
});

export const saveItems = internalMutation({
	args: {
		icons: v.array(v.object({ itemId: v.number(), url: v.union(v.string(), v.null()) })),
		infos: v.array(
			v.object({
				itemId: v.union(v.number(), v.null()),
				name: v.string(),
				quality: v.union(v.number(), v.null())
			})
		)
	},
	handler: async (ctx, { icons, infos }) => {
		for (const icon of icons) {
			const hit = await ctx.db
				.query('itemIcons')
				.withIndex('by_item', (q) => q.eq('itemId', icon.itemId))
				.first();
			if (!hit) await ctx.db.insert('itemIcons', icon);
		}
		const now = Date.now();
		for (const info of infos) {
			const hit = await ctx.db
				.query('itemInfo')
				.withIndex('by_name', (q) => q.eq('name', info.name))
				.first();
			if (!hit) await ctx.db.insert('itemInfo', { ...info, at: now });
			else if (hit.quality === null)
				await ctx.db.replace('itemInfo', hit._id, { ...info, at: now });
		}
	}
});

/** Kakovost in ID iz cachea v loot in rolle runa, kjer ju še ni (addon ima prednost: ne prepiše). */
export const applyItems = internalMutation({
	args: { runId: v.id('runs') },
	handler: async (ctx, { runId }) => {
		const d = await ctx.db
			.query('runDetails')
			.withIndex('by_run', (q) => q.eq('runId', runId))
			.unique();
		if (!d) return 0;
		const cache = new Map<string, { itemId: number | null; quality: number | null }>();
		const info = async (name: string) => {
			if (!cache.has(name)) {
				const hit = await ctx.db
					.query('itemInfo')
					.withIndex('by_name', (q) => q.eq('name', name))
					.first();
				cache.set(name, { itemId: hit?.itemId ?? null, quality: hit?.quality ?? null });
			}
			return cache.get(name)!;
		};
		let changed = 0;
		const fill = async <T extends { item: string; itemId: number | null; quality: number | null }>(
			x: T
		) => {
			if (x.quality !== null) return x;
			const i = await info(x.item);
			if (i.quality === null) return x;
			changed++;
			return { ...x, quality: i.quality, itemId: x.itemId ?? i.itemId };
		};
		const loot = await Promise.all((d.loot ?? []).map(fill));
		const rolls = await Promise.all((d.rolls ?? []).map(fill));
		if (changed) await ctx.db.patch('runDetails', d._id, { loot, ...(d.rolls ? { rolls } : {}) });
		return changed;
	}
});

/**
 * Po uploadu: ikone in imena opreme (po ID-ju) ter kakovost lootu in rollov (po imenu iz chat loga)
 * iz Blizzardovega API-ja – brez addona in brez /reload. Vse se shrani za vedno (tudi neuspeh).
 */
export const enrichItems = internalAction({
	args: { runId: v.id('runs') },
	handler: async (ctx, { runId }) => {
		const work: { icons: number[]; ids: number[]; names: string[] } = await ctx.runQuery(
			internal.companion.itemWork,
			{ runId, now: Date.now() }
		);
		const icons = await mapLimit(work.icons, 4, async (itemId) => ({
			itemId,
			url: await itemIcon(itemId)
		}));
		const byId = await mapLimit(work.ids, 4, async (itemId) => {
			const r = await itemById(itemId).catch(() => null);
			return r ? { itemId, name: r.name, quality: r.quality } : null;
		});
		const byName = await mapLimit(work.names, 4, async (name) => {
			const r = await itemByName(name).catch(() => null);
			return { name, itemId: r?.itemId ?? null, quality: r?.quality ?? null };
		});
		const infos = [...byId.filter((x): x is NonNullable<typeof x> => x !== null), ...byName];
		if (icons.length || infos.length)
			await ctx.runMutation(internal.companion.saveItems, { icons, infos });
		const filled: number = await ctx.runMutation(internal.companion.applyItems, { runId });
		return { icons: icons.length, ids: byId.length, names: byName.length, filled };
	}
});

/** CLI/enkratno: dopolni predmete (imena, kakovost, ikone) za vse rune (`companion:enrichAllRuns '{}'`). */
export const enrichAllRuns = internalMutation({
	args: {},
	handler: async (ctx) => {
		const runs = await ctx.db.query('runs').withIndex('by_started_at').order('desc').take(300);
		for (let i = 0; i < runs.length; i++) {
			await ctx.scheduler.runAfter(i * 3000, internal.companion.enrichItems, {
				runId: runs[i]._id
			});
		}
		return runs.length;
	}
});
