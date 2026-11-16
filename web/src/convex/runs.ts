// Dungeon Runs na portalu (Companion C5). Vidnost: polja runs / runDetails / runDeaths (+ classId) v lib/runsView.ts.
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel.js';
import { query, type QueryCtx } from './_generated/server.js';
import { canSeePrivate } from './lib/access.js';
import { recordKind } from './lib/companionSchema.js';
import { castFailAwards } from './lib/companion.js';
import { runDetail, runListItem, type DetailsLike, type RunDocLike } from './lib/runsView.js';
import { allStars, rankings as buildRankings } from './lib/parses.js';
import { loadHeroLogs } from './lib/parsesDb.js';
import { getSettings } from './lib/settings.js';
import { listSeasons } from './seasons.js';

async function visibility(ctx: QueryCtx) {
	const [privateOk, settings] = await Promise.all([canSeePrivate(ctx), getSettings(ctx)]);
	const pub = new Set(settings.publicFields);
	return { privateOk, allowed: (k: string) => privateOk || pub.has(k) };
}

/** slug -> classId za člane partyja, ki jih portal spremlja. */
async function classesFor(ctx: QueryCtx, runs: Doc<'runs'>[]) {
	const slugs = new Set(runs.flatMap((r) => r.party.filter((p) => p.playerId).map((p) => p.slug)));
	const out = new Map<string, number>();
	for (const slug of slugs) {
		const s = await ctx.db
			.query('summaries')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.first();
		if (s) out.set(slug, s.classId);
	}
	return out;
}

/** Kaj gledalec sme videti (za sporočila "members only" v UI). */
export const access = query({
	args: {},
	handler: async (ctx) => {
		const { privateOk, allowed } = await visibility(ctx);
		return {
			private: privateOk,
			runs: allowed('runs'),
			details: allowed('runDetails'),
			deaths: allowed('runDeaths')
		};
	}
});

/** Seznam runov, najnovejši prvi (paginirano). */
export const list = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, { paginationOpts }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs')) return { page: [], isDone: true, continueCursor: '' };
		const res = await ctx.db
			.query('runs')
			.withIndex('by_started_at')
			.order('desc')
			.paginate(paginationOpts);
		const classOf = await classesFor(ctx, res.page);
		return { ...res, page: res.page.map((r) => runListItem(r as RunDocLike, classOf, allowed)) };
	}
});

/** En run z analizo (prirezano po vidnosti). */
export const get = query({
	args: { id: v.string() },
	handler: async (ctx, { id }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs')) return { locked: true as const };
		const runId = ctx.db.normalizeId('runs', id);
		const run = runId ? await ctx.db.get('runs', runId) : null;
		if (!run) return null;
		const details =
			allowed('runDetails') || allowed('runDeaths') || allowed('runLoot')
				? await ctx.db
						.query('runDetails')
						.withIndex('by_run', (q) => q.eq('runId', run._id))
						.unique()
				: null;
		const classOf = await classesFor(ctx, [run]);
		// pridobitve snemalcev (XP, denar, reputacija) – majhne vrstice, številke -> runDetails
		const progress = allowed('runDetails')
			? (
					await ctx.db
						.query('runProgress')
						.withIndex('by_run_and_slug', (q) => q.eq('runId', run._id))
						.take(10)
				).map(({ _id: _i, _creationTime: _c, runId: _r, ...g }) => g)
			: [];
		return {
			locked: false as const,
			run: {
				...runDetail(run as RunDocLike, details as DetailsLike | null, classOf, allowed),
				progress,
				hasReplay: (run.hasReplay ?? false) && allowed('runDetails'),
				// nagrade za neuspele caste (vsak snemalec ima v logu samo svoje)
				failAwards: castFailAwards(progress)
			}
		};
	}
});

/** Runi enega junaka (zavihek na strani junaka). */
export const forHero = query({
	args: { slug: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { slug, limit = 20 }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs')) return { locked: true as const, runs: [], records: null };
		const parts = await ctx.db
			.query('runParticipants')
			.withIndex('by_slug_and_started_at', (q) => q.eq('slug', slug))
			.order('desc')
			.take(Math.min(50, Math.max(1, limit)));
		const runs = (await Promise.all(parts.map((p) => ctx.db.get('runs', p.runId)))).filter(
			(r): r is Doc<'runs'> => r !== null
		);
		const classOf = await classesFor(ctx, runs);
		// osebni rekordi (≤ 5 majhnih vrstic); številke -> polje runDetails
		const records = allowed('runDetails')
			? (
					await ctx.db
						.query('heroRecords')
						.withIndex('by_slug_and_kind', (q) => q.eq('slug', slug))
						.take(10)
				).map(recordView)
			: null;
		return {
			locked: false as const,
			runs: runs.map((r) => runListItem(r as RunDocLike, classOf, allowed)),
			records
		};
	}
});

/**
 * Zavihek Logs na strani junaka (Company Parses, docs/STATS.md §6): po bossu najboljši/median
 * percentil, najhitrejši uboj in vsi uboji v izbrani sezoni. Številke -> polje runDetails.
 * Bere parse junaka (≤ 500) in za vsako skupino (boss + težavnost + vloga) ≤ 1000 vrstic po ~250 B.
 */
export const heroLogs = query({
	args: { slug: v.string(), season: v.optional(v.number()) },
	handler: async (ctx, { slug, season }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs') || !allowed('runDetails')) return { locked: true as const };
		return { locked: false as const, ...(await loadHeroLogs(ctx, slug, season)) };
	}
});

/**
 * Ikone, imena in kakovost opreme enega igralca ob zadnjem pullu (ob kliku na igralca, ne ob vsakem
 * ogledu runa – DB I/O). Seznam, ne objekt (Convex ključi morajo biti ASCII imena).
 */
export const gear = query({
	args: { id: v.string(), slug: v.string() },
	handler: async (ctx, { id, slug }) => {
		const { allowed } = await visibility(ctx);
		const runId = ctx.db.normalizeId('runs', id);
		if (!runId || !allowed('runs') || !allowed('runDetails')) return [];
		const details = await ctx.db
			.query('runDetails')
			.withIndex('by_run', (q) => q.eq('runId', runId))
			.unique();
		const items = details?.players.find((p) => p.slug === slug)?.gear ?? [];
		const out: {
			itemId: number;
			url: string | null;
			name: string | null;
			quality: number | null;
		}[] = [];
		for (const { itemId } of items) {
			const icon = await ctx.db
				.query('itemIcons')
				.withIndex('by_item', (q) => q.eq('itemId', itemId))
				.first();
			const info = await ctx.db
				.query('itemInfo')
				.withIndex('by_itemId', (q) => q.eq('itemId', itemId))
				.first();
			out.push({
				itemId,
				url: icon?.url ?? null,
				name: info?.name ?? null,
				quality: info?.quality ?? null
			});
		}
		return out;
	}
});

/** Razčlenitev enega boss boja (ob kliku na igralca na strani runa). Številke -> polje runDetails. */
export const bossDetail = query({
	args: { id: v.string(), index: v.number() },
	handler: async (ctx, { id, index }) => {
		const { allowed } = await visibility(ctx);
		const runId = ctx.db.normalizeId('runs', id);
		if (!runId || !allowed('runs') || !allowed('runDetails')) return null;
		const doc = await ctx.db
			.query('runBossDetails')
			.withIndex('by_run_and_index', (q) => q.eq('runId', runId).eq('index', index))
			.unique();
		return doc?.players ?? null;
	}
});

/** Replay (pozicije partyja); bere se samo, ko je zavihek Replay odprt. */
export const replay = query({
	args: { id: v.string() },
	handler: async (ctx, { id }) => {
		const { allowed } = await visibility(ctx);
		const runId = ctx.db.normalizeId('runs', id);
		if (!runId || !allowed('runs') || !allowed('runDetails')) return null;
		const doc = await ctx.db
			.query('runReplay')
			.withIndex('by_run', (q) => q.eq('runId', runId))
			.unique();
		return doc ? { bucketMs: doc.bucketMs, players: doc.players } : null;
	}
});

/**
 * Lestvice sezone (/rankings): po dungeonu in bossu top 10 DPS in HPS (en vnos na junaka) +
 * najhitrejši cleari po dungeonu. Bere ≤ 3000 parsov (~250 B) in ≤ 300 zadnjih runov.
 */
export const rankings = query({
	args: { season: v.optional(v.number()) },
	handler: async (ctx, { season }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs') || !allowed('runDetails')) return { locked: true as const };
		const seasons = await listSeasons(ctx);
		const chosen = season ?? seasons[0].number;
		// najboljši po junaku in skupini že stoji v parsePools (en dokument na boss/vlogo)
		const pools = await ctx.db
			.query('parsePools')
			.withIndex('by_season', (q) => q.eq('season', chosen))
			.take(300);
		const rows = pools.flatMap((p) =>
			p.entries.map((e) => ({
				slug: e.slug,
				encounterId: p.encounterId,
				encounter: p.encounter,
				zone: p.zone,
				difficultyId: p.difficultyId,
				role: p.role,
				dps: p.role === 'heal' ? 0 : e.value,
				hps: p.role === 'heal' ? e.value : 0,
				taken: 0,
				durationMs: e.durationMs,
				ilvl: e.ilvl,
				at: e.at,
				runId: e.runId as string
			}))
		);
		const boards = buildRankings(rows);
		const stars = allStars(rows);

		// najhitrejši cleari: majhne vrstice `clears`, top 5 po dungeonu
		const clears = await ctx.db
			.query('clears')
			.withIndex('by_season_and_zone_and_durationMs', (q) => q.eq('season', chosen))
			.take(500);
		const byZone = new Map<string, typeof clears>();
		for (const c of clears) {
			const list = byZone.get(c.zone) ?? [];
			if (list.length < 5) list.push(c);
			byZone.set(c.zone, list);
		}

		// imena in razredi (seznam, ne objekt: slugi so lahko cirilični)
		const names = new Map<string, string>();
		for (const c of clears) for (const p of c.party) names.set(p.slug, p.name);
		const slugs = new Set([...rows.map((r) => r.slug), ...names.keys()]);
		const people = [];
		for (const slug of slugs) {
			let name = names.get(slug);
			if (!name) {
				const p = await ctx.db
					.query('players')
					.withIndex('by_slug', (q) => q.eq('slug', slug))
					.first();
				name = p?.displayName ?? slug;
			}
			const sum = allowed('classId')
				? await ctx.db
						.query('summaries')
						.withIndex('by_slug', (q) => q.eq('slug', slug))
						.first()
				: null;
			people.push({ slug, name, classId: sum?.classId ?? null });
		}
		// najbolj donosni dungeoni: povprečni XP/uro in zlato/uro iz pridobitev snemalcev
		const gains = await ctx.db
			.query('runProgress')
			.withIndex('by_season', (q) => q.eq('season', chosen))
			.take(1000);
		const byZoneValue = new Map<
			string,
			{ runs: number; xp: number; copper: number; hours: number }
		>();
		for (const g of gains) {
			const e = byZoneValue.get(g.zone) ?? { runs: 0, xp: 0, copper: 0, hours: 0 };
			e.runs += 1;
			e.xp += g.xp;
			e.copper += g.copper;
			e.hours += Math.max(g.durationMs, 60_000) / 3_600_000;
			byZoneValue.set(g.zone, e);
		}
		// Keyboard Hall of Shame: pritiski, preden je bil urok pripravljen, na uro (samo snemalci)
		const mash = new Map<string, { spam: number; hours: number }>();
		for (const g of gains) {
			if (!g.castFails) continue;
			const e = mash.get(g.slug) ?? { spam: 0, hours: 0 };
			e.spam += g.castFails.spam;
			e.hours += Math.max(g.durationMs, 60_000) / 3_600_000;
			mash.set(g.slug, e);
		}
		const mashers = [...mash.entries()]
			.filter(([, e]) => e.spam >= 20)
			.map(([slug, e]) => ({ slug, spam: e.spam, perHour: Math.round(e.spam / e.hours) }))
			.sort((a, b) => b.perHour - a.perHour)
			.slice(0, 10);
		for (const m of mashers) {
			if (people.some((p) => p.slug === m.slug)) continue;
			const p = await ctx.db
				.query('players')
				.withIndex('by_slug', (q) => q.eq('slug', m.slug))
				.first();
			const sum = allowed('classId')
				? await ctx.db
						.query('summaries')
						.withIndex('by_slug', (q) => q.eq('slug', m.slug))
						.first()
				: null;
			people.push({ slug: m.slug, name: p?.displayName ?? m.slug, classId: sum?.classId ?? null });
		}
		const value = [...byZoneValue.entries()]
			.map(([zone, e]) => ({
				zone,
				runs: e.runs,
				xpPerHour: Math.round(e.xp / e.hours),
				copperPerHour: Math.round(e.copper / e.hours)
			}))
			.sort((a, b) => b.xpPerHour - a.xpPerHour);
		return {
			locked: false as const,
			seasons,
			season: chosen,
			boards,
			stars,
			value,
			mashers,
			speed: [...byZone.entries()]
				.map(([zone, list]) => ({
					zone,
					runs: list.map((c) => ({
						id: c.runId,
						durationMs: c.durationMs,
						startedAt: c.startedAt,
						deaths: c.deaths,
						party: c.party.map((p) => p.slug)
					}))
				}))
				.sort((a, b) => a.zone.localeCompare(b.zone)),
			people
		};
	}
});

const recordView = (r: Doc<'heroRecords'>) => ({
	slug: r.slug,
	kind: r.kind,
	amount: r.amount,
	spell: r.spell,
	unit: r.unit,
	pet: r.pet,
	runId: r.runId ?? null,
	zone: r.zone,
	/** true = zunaj dungeon runa (osebni rekordi iz celega loga) */
	world: r.world ?? false,
	at: r.at
});

/**
 * Lestvica: največji rekord ene vrste med vsemi junaki (privzeto crit). null = skrito.
 * Bere samo majhne vrstice heroRecords – imena in razrede ima glavna stran že iz players.list.
 */
export const topRecords = query({
	args: { kind: v.optional(recordKind), limit: v.optional(v.number()) },
	handler: async (ctx, { kind = 'crit', limit = 10 }) => {
		const { allowed } = await visibility(ctx);
		if (!allowed('runs') || !allowed('runDetails')) return null;
		const rows = await ctx.db
			.query('heroRecords')
			.withIndex('by_kind_and_amount', (q) => q.eq('kind', kind))
			.order('desc')
			.take(Math.min(25, Math.max(1, limit)));
		return rows.map(recordView);
	}
});
