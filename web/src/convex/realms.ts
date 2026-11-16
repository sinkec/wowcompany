// Realm druščine in arhivi (docs/README.md). Menjava realma: junaki, runi in sezone starega realma
// dobijo oznako arhiva (samo branje za člane), začne se nova sezona. Vrnitev v ARCHIVE_DAYS dneh vse
// obnovi; potem dnevni cron arhiv izbriše v paketih.
import { ConvexError, v } from 'convex/values';
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx
} from './_generated/server.js';
import { internal } from './_generated/api.js';
import type { Doc } from './_generated/dataModel.js';
import { canSeePrivate, requireAdmin } from './lib/access.js';
import { deletePlayer, pollState } from './lib/players.js';
import {
	ARCHIVE_DAYS,
	DAY,
	REGIONS,
	RULESETS,
	daysLeft,
	realmKey,
	realmLabel,
	validRealm,
	type Realm
} from './lib/realms.js';
import { DEFAULT_SETTINGS } from './lib/settings.js';
import { addCompanyNews } from './news.js';

const BATCH = 100;

async function settingsDoc(ctx: MutationCtx) {
	const doc = await ctx.db
		.query('settings')
		.withIndex('by_key', (q) => q.eq('key', 'main'))
		.unique();
	if (doc) return doc;
	const id = await ctx.db.insert('settings', { key: 'main', ...DEFAULT_SETTINGS });
	return (await ctx.db.get('settings', id))!;
}

/** Za akcije (regija za Blizzard API). */
export const current = internalQuery({
	args: {},
	handler: async (ctx) => {
		const doc = await ctx.db
			.query('settings')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		return doc?.realm ?? null;
	}
});

/** Za Guild Master's Office: realm, možnosti in arhivi. */
export const state = query({
	args: { now: v.number() },
	handler: async (ctx, { now }) => {
		await requireAdmin(ctx);
		const doc = await ctx.db
			.query('settings')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		const archives = await ctx.db.query('archives').withIndex('by_deleteAt').take(20);
		return {
			realm: doc?.realm
				? { ...doc.realm, key: realmKey(doc.realm), label: realmLabel(doc.realm) }
				: null,
			regions: [...REGIONS],
			rulesets: [...RULESETS],
			archives: archives.map((a) => ({
				key: a.key,
				label: realmLabel(a),
				archivedAt: a.archivedAt,
				deleteAt: a.deleteAt,
				daysLeft: daysLeft(a.deleteAt, now),
				heroes: a.heroes,
				runs: a.runs
			}))
		};
	}
});

/** Kaj gre v arhiv ob menjavi (za opozorilo; bere samo, ko je okno odprto). */
export const preview = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const heroes = (await ctx.db.query('players').take(1000)).filter((p) => p.active).length;
		const runs = await ctx.db
			.query('runs')
			.withIndex('by_archived_and_started_at', (q) => q.eq('archived', undefined))
			.take(2000);
		const seasons = (await ctx.db.query('seasons').take(100)).filter((s) => !s.archived).length;
		return { heroes, runs: runs.length, seasons: Math.max(1, seasons) };
	}
});

async function startSeason(ctx: MutationCtx, realm: Realm, now: number) {
	const last = await ctx.db.query('seasons').withIndex('by_number').order('desc').first();
	const number = (last?.number ?? 1) + 1;
	await ctx.db.insert('seasons', {
		number,
		name: `${realmLabel(realm)} · Season ${number}`,
		startedAt: now,
		patch: (await settingsDoc(ctx)).gamePatch ?? null
	});
}

/**
 * Izbira ali menjava realma. Prva izbira samo zapiše realm. Menjava: vse aktivno gre v arhiv starega
 * realma; če obstaja arhiv novega realma (vrnitev v 30 dneh), se obnovi, sicer se začne nova sezona.
 * `confirm` = oznaka novega realma, kot jo je Guild Master vtipkal (zaščita pred nehotenim klikom).
 */
export const setRealm = mutation({
	args: { region: v.string(), ruleset: v.string(), confirm: v.optional(v.string()) },
	handler: async (ctx, a) => {
		await requireAdmin(ctx);
		return moveRealm(ctx, a);
	}
});

/** CLI (dev preizkus, reševanje): `bunx convex run realms:setRealmCli '{"region":"eu","ruleset":"PvP","confirm":"EU · PvP"}'` */
export const setRealmCli = internalMutation({
	args: { region: v.string(), ruleset: v.string(), confirm: v.optional(v.string()) },
	handler: async (ctx, a) => moveRealm(ctx, a)
});

async function moveRealm(
	ctx: MutationCtx,
	{ region, ruleset, confirm }: { region: string; ruleset: string; confirm?: string }
) {
	{
		const next = { region, ruleset };
		if (!validRealm(next)) throw new ConvexError('Unknown realm.');
		const now = Date.now();
		const doc = await settingsDoc(ctx);
		const old = doc.realm;
		if (old && realmKey(old) === realmKey(next)) return { changed: false, restored: false };

		if (!old) {
			// prva izbira: Season 1 dobi zapis, nič ne gre v arhiv
			const first = await ctx.db.query('seasons').withIndex('by_number').first();
			if (!first)
				await ctx.db.insert('seasons', {
					number: 1,
					name: `${realmLabel(next)} · Season 1`,
					startedAt: 0,
					patch: doc.gamePatch ?? null
				});
			await ctx.db.patch('settings', doc._id, { realm: { ...next, since: now } });
			return { changed: true, restored: false };
		}

		if ((confirm ?? '').trim().toLowerCase() !== realmLabel(next).toLowerCase())
			throw new ConvexError(`Type "${realmLabel(next)}" to confirm.`);

		// 1) vse aktivno v arhiv starega realma
		const oldKey = realmKey(old);
		const ps = await pollState(ctx);
		const archivedIds = new Set<string>();
		let heroes = 0;
		for (const p of await ctx.db.query('players').take(1000)) {
			if (!p.active) continue;
			await ctx.db.patch('players', p._id, { active: false, archived: oldKey });
			archivedIds.add(p._id);
			heroes++;
		}
		for (const s of await ctx.db.query('seasons').take(100))
			if (!s.archived) await ctx.db.patch('seasons', s._id, { archived: oldKey });
		const prior = await ctx.db
			.query('archives')
			.withIndex('by_key', (q) => q.eq('key', oldKey))
			.unique();
		if (prior) await ctx.db.delete('archives', prior._id);
		await ctx.db.insert('archives', {
			key: oldKey,
			region: old.region,
			ruleset: old.ruleset,
			archivedAt: now,
			deleteAt: now + ARCHIVE_DAYS * DAY,
			heroes,
			runs: 0
		});

		// 2) vrnitev v 30 dneh: obnovi arhiv novega realma
		const newKey = realmKey(next);
		const back = await ctx.db
			.query('archives')
			.withIndex('by_key', (q) => q.eq('key', newKey))
			.unique();
		let entries = (ps?.entries ?? []).filter((e) => !archivedIds.has(e.playerId));
		if (back && !back.purging) {
			for (const p of await ctx.db
				.query('players')
				.withIndex('by_archived', (q) => q.eq('archived', newKey))
				.take(1000)) {
				await ctx.db.patch('players', p._id, { active: true, archived: undefined });
				entries = [...entries, { playerId: p._id, slug: p.slug }];
			}
			for (const s of await ctx.db.query('seasons').take(100))
				if (s.archived === newKey) await ctx.db.patch('seasons', s._id, { archived: undefined });
			await ctx.db.delete('archives', back._id);
		} else {
			await startSeason(ctx, next, now);
		}
		// runi: najprej aktivni v arhiv starega realma, šele potem (ob vrnitvi) obnova novega
		await ctx.scheduler.runAfter(0, internal.realms.moveRuns, {
			from: '',
			to: oldKey,
			...(back && !back.purging ? { then: { from: newKey, to: '' } } : {})
		});
		if (ps) await ctx.db.patch('pollState', ps._id, { entries });
		await ctx.db.patch('settings', doc._id, { realm: { ...next, since: now } });
		await addCompanyNews(
			ctx,
			`realm-${newKey}-${now}`,
			`The company moved to ${realmLabel(next)}`,
			back
				? `Back home. Everything from ${realmLabel(next)} is restored – heroes, runs and ladders.`
				: `New realm, new season. The ${realmLabel(old)} days stay in the archive for ${ARCHIVE_DAYS} days.`
		);
		return { changed: true, restored: !!back };
	}
}

/** Runi iz enega stanja v drugo ('' = aktivni), v paketih (indeks archived + startedAt). */
export const moveRuns = internalMutation({
	args: {
		from: v.string(),
		to: v.string(),
		/** naslednji premik, šele ko je ta končan (najprej arhiviraj aktivne, potem obnovi stare) */
		then: v.optional(v.object({ from: v.string(), to: v.string() }))
	},
	handler: async (ctx, { from, to, then }) => {
		const rows = await ctx.db
			.query('runs')
			.withIndex('by_archived_and_started_at', (q) => q.eq('archived', from || undefined))
			.take(BATCH);
		for (const r of rows) await ctx.db.patch('runs', r._id, { archived: to || undefined });
		if (to) {
			const a = await ctx.db
				.query('archives')
				.withIndex('by_key', (q) => q.eq('key', to))
				.unique();
			if (a) await ctx.db.patch('archives', a._id, { runs: a.runs + rows.length });
		}
		if (rows.length === BATCH)
			await ctx.scheduler.runAfter(0, internal.realms.moveRuns, { from, to, then });
		else if (then) await ctx.scheduler.runAfter(0, internal.realms.moveRuns, then);
		return null;
	}
});

/** Cron: arhivi, ki jim je potekel čas, se začnejo brisati. */
export const purgeExpired = internalMutation({
	args: {},
	handler: async (ctx) => {
		const due = await ctx.db
			.query('archives')
			.withIndex('by_deleteAt', (q) => q.lte('deleteAt', Date.now()))
			.take(5);
		for (const a of due) {
			if (!a.purging) await ctx.db.patch('archives', a._id, { purging: true });
			await ctx.scheduler.runAfter(0, internal.realms.purgeBatch, { key: a.key });
		}
		return null;
	}
});

/** Briše en arhiv po kosih: runi (z vsemi podatki), junaki, sezone s parsi, na koncu zapis arhiva. */
export const purgeBatch = internalMutation({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		const again = () => ctx.scheduler.runAfter(0, internal.realms.purgeBatch, { key });
		const runs = await ctx.db
			.query('runs')
			.withIndex('by_archived_and_started_at', (q) => q.eq('archived', key))
			.take(10);
		if (runs.length) {
			for (const r of runs) await ctx.runMutation(internal.companion.deleteRun, { runId: r._id });
			await again();
			return null;
		}
		const heroes = await ctx.db
			.query('players')
			.withIndex('by_archived', (q) => q.eq('archived', key))
			.take(5);
		if (heroes.length) {
			for (const p of heroes) await deletePlayer(ctx, p._id);
			await again();
			return null;
		}
		const seasons = (await ctx.db.query('seasons').take(100)).filter((s) => s.archived === key);
		for (const s of seasons) {
			for (const table of ['parses', 'parsePools', 'clears'] as const) {
				const left =
					table === 'clears'
						? await ctx.db
								.query('clears')
								.withIndex('by_season_and_zone_and_durationMs', (q) => q.eq('season', s.number))
								.take(50)
						: await ctx.db
								.query(table)
								.withIndex('by_season', (q) => q.eq('season', s.number))
								.take(50);
				for (const d of left) await ctx.db.delete(table, d._id);
				if (left.length === 50) {
					await again();
					return null;
				}
			}
			await ctx.db.delete('seasons', s._id);
		}
		const a = await ctx.db
			.query('archives')
			.withIndex('by_key', (q) => q.eq('key', key))
			.unique();
		if (a) await ctx.db.delete('archives', a._id);
		return null;
	}
});

/** Za člane: seznam arhivov (stran /archive). */
export const list = query({
	args: { now: v.number() },
	handler: async (ctx, { now }) => {
		if (!(await canSeePrivate(ctx))) return null;
		const rows = await ctx.db.query('archives').withIndex('by_deleteAt').take(20);
		return rows.map((a) => ({
			key: a.key,
			label: realmLabel(a),
			archivedAt: a.archivedAt,
			deleteAt: a.deleteAt,
			daysLeft: daysLeft(a.deleteAt, now),
			heroes: a.heroes,
			runs: a.runs,
			purging: a.purging ?? false
		}));
	}
});

/** Za člane: vsebina enega arhiva (junaki, zadnji runi, sezone) – tudi za prenos (JSON). */
export const contents = query({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		if (!(await canSeePrivate(ctx))) return null;
		const players = await ctx.db
			.query('players')
			.withIndex('by_archived', (q) => q.eq('archived', key))
			.take(500);
		const heroes = [];
		for (const p of players) {
			const s: Doc<'summaries'> | null = await ctx.db
				.query('summaries')
				.withIndex('by_player', (q) => q.eq('playerId', p._id))
				.unique();
			heroes.push({
				slug: p.slug,
				name: p.displayName,
				level: s?.level ?? null,
				classId: s?.classId ?? null,
				className: s?.className ?? null,
				race: s?.race ?? null,
				avatar: s?.avatar ?? null,
				ilvl: s?.ilvlEquipped ?? null,
				kills: s?.kills ?? null,
				deaths: s?.deaths ?? null,
				quests: s?.quests ?? null
			});
		}
		heroes.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
		const runs = await ctx.db
			.query('runs')
			.withIndex('by_archived_and_started_at', (q) => q.eq('archived', key))
			.order('desc')
			.take(100);
		const seasons = (await ctx.db.query('seasons').take(100))
			.filter((s) => s.archived === key)
			.map((s) => ({ number: s.number, name: s.name, startedAt: s.startedAt }));
		return {
			heroes,
			seasons,
			runs: runs.map((r) => ({
				id: r._id,
				zone: r.zone.name,
				startedAt: r.startedAt,
				durationMs: r.durationMs,
				bossesKilled: r.result.bossesKilled,
				bossesTotal: r.result.bossesTotal,
				cleared: r.result.cleared,
				party: r.party.map((m) => m.name)
			}))
		};
	}
});
