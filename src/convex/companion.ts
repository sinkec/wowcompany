// WowCompany Companion: povezava naprave, objava runov (COMPANION.md §7–8).
// HTTP vstopne točke so v companionHttp.ts; tu so mutacije/poizvedbe.
import { HOUR, MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { ConvexError, v } from 'convex/values';
import { components } from './_generated/api.js';
import type { Id } from './_generated/dataModel.js';
import {
	internalMutation,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server.js';
import { getViewer } from './lib/access.js';
import {
	addRecorder,
	checkRun,
	computeAwards,
	LINK_TTL_MS,
	normalizeCode,
	runScore
} from './lib/companion.js';
import { runSummary, type RunSummary } from './lib/companionSchema.js';

const limiter = new RateLimiter(components.rateLimiter, {
	// Cela platforma: največ 30 novih povezav na uro (prijateljska skupina).
	companionLinkStart: { kind: 'fixed window', rate: 30, period: HOUR },
	// Na povezavo: aplikacija polla vsake ~3 s.
	companionLinkPoll: { kind: 'token bucket', rate: 40, period: MINUTE, capacity: 10 },
	// Na napravo: ~1 run na 2 min v povprečju, do 10 naenkrat (čakalna vrsta po izpadu interneta).
	companionUpload: { kind: 'token bucket', rate: 30, period: HOUR, capacity: 10 }
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
		const existing = await ctx.db
			.query('runs')
			.withIndex('by_run_key', (q) => q.eq('runKey', s.runKey))
			.first();

		const details = {
			players: s.players,
			segments: s.segments,
			deaths: s.deaths,
			timeline: s.timeline
		};
		const runFields = {
			schema: s.schema,
			zone: s.zone,
			startedAt: s.startedAt,
			endedAt: s.endedAt,
			durationMs: s.durationMs,
			endReason: s.endReason,
			result: s.result,
			awards: computeAwards(s.players),
			score
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
			await writeParticipants(ctx, runId, party, s.startedAt);
			return { runId, created: true, recorderAdded: true, replaced: false };
		}

		const { list: recordedBy, added } = addRecorder(existing.recordedBy, rec);
		const better = score > existing.score;
		if (better) {
			const party = await partyFor(ctx, s);
			await ctx.db.patch('runs', existing._id, { ...runFields, party, recordedBy, updatedAt: now });
			const old = await ctx.db
				.query('runDetails')
				.withIndex('by_run', (q) => q.eq('runId', existing._id))
				.unique();
			if (old) await ctx.db.replace('runDetails', old._id, { runId: existing._id, ...details });
			else await ctx.db.insert('runDetails', { runId: existing._id, ...details });
			await writeParticipants(ctx, existing._id, party, s.startedAt);
		} else if (added) {
			await ctx.db.patch('runs', existing._id, { recordedBy, updatedAt: now });
		}
		return { runId: existing._id, created: false, recorderAdded: added, replaced: better };
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
		if (await ctx.db.get('runs', runId)) await ctx.db.delete('runs', runId);
		return null;
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
