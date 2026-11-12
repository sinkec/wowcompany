// Poller: 1 cron -> 1 akcija, ki v zanki obdela vse igralce (nikoli funkcija na igralca).
// Večina zahtev vrne 304 (If-Modified-Since), zato je akcija kratka in poceni.
import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import { internalAction, internalMutation, internalQuery } from './_generated/server.js';
import { classSpecs, get, getCharacterParts, itemIcon, mapLimit, profileNs, talentInfo, type RawCharacter } from './lib/blizzard.js';
import { itemIds, normalize, talentRefs, type Item } from './lib/normalize.js';
import { getSettings } from './lib/settings.js';
import { detailFields, summaryFields } from './schema.js';
import type { Id } from './_generated/dataModel.js';

type PollEntry = { playerId: Id<'players'>; slug: string; lastModified?: string; lastLogin?: number };
type PollStateResult = { paused: boolean; intervalSec: number; entries: PollEntry[] };
type RunResult =
	| { skipped: true }
	| { checked: number; changed: number; notModified: number; notFound: number; failed: number };

const CONCURRENCY = 10;

/** Samo števci, ki so v tej seji zrasli. */
function counterDeltas(prev?: Record<string, number>, next?: Record<string, number>) {
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(next ?? {})) {
		const d = v - (prev?.[k] ?? 0);
		if (d > 0) out[k] = d;
	}
	return out;
}

/** Poklici, ki so v tej seji napredovali. */
function professionUps(prev: unknown, next: unknown) {
	type P = { name: string; skill: number; max: number };
	const before = new Map(((prev ?? []) as P[]).map((p) => [p.name, p.skill]));
	return ((next ?? []) as P[])
		.filter((p) => p.skill > (before.get(p.name) ?? 0))
		.map((p) => ({ name: p.name, from: before.get(p.name) ?? 0, to: p.skill, max: p.max }));
}

/** En majhen dokument + nastavitve: edino, kar cron prebere vsako minuto. */
export const state = internalQuery({
	args: {},
	handler: async (ctx): Promise<PollStateResult> => {
		const settings = await getSettings(ctx);
		const ps = await ctx.db
			.query('pollState')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		return { paused: settings.paused, intervalSec: settings.pollIntervalSec, entries: ps?.entries ?? [] };
	}
});

export const cachedIcons = internalQuery({
	args: { ids: v.array(v.number()) },
	handler: async (ctx, { ids }) => {
		const out: { itemId: number; url: string | null }[] = [];
		for (const itemId of ids) {
			const doc = await ctx.db
				.query('itemIcons')
				.withIndex('by_item', (q) => q.eq('itemId', itemId))
				.unique();
			if (doc) out.push({ itemId, url: doc.url });
		}
		return out;
	}
});

type TalentRow = { talentId: number; maxRank: number; icon: string | null };
type SpecRow = { classId: number; specs: { id: number; name: string }[] };

export const cachedTalents = internalQuery({
	args: { talentIds: v.array(v.number()), classIds: v.array(v.number()) },
	handler: async (ctx, { talentIds, classIds }): Promise<{ talents: TalentRow[]; specs: SpecRow[] }> => {
		const talents: TalentRow[] = [];
		for (const talentId of talentIds) {
			const d = await ctx.db
				.query('talentInfo')
				.withIndex('by_talent', (q) => q.eq('talentId', talentId))
				.unique();
			if (d) talents.push({ talentId, maxRank: d.maxRank, icon: d.icon });
		}
		const specs: SpecRow[] = [];
		for (const classId of classIds) {
			const d = await ctx.db
				.query('classSpecs')
				.withIndex('by_class', (q) => q.eq('classId', classId))
				.unique();
			if (d) specs.push({ classId, specs: d.specs });
		}
		return { talents, specs };
	}
});

export const run = internalAction({
	args: { force: v.optional(v.boolean()) },
	handler: async (ctx, { force }): Promise<RunResult> => {
		const st: PollStateResult = await ctx.runQuery(internal.poll.state, {});
		if (st.entries.length === 0 || (st.paused && !force)) return { skipped: true };

		// Interval > 60 s brez pisanja v bazo: teče samo v "svojih" minutah.
		const everyMin = Math.max(1, Math.round(st.intervalSec / 60));
		if (!force && Math.floor(Date.now() / 60_000) % everyMin !== 0) return { skipped: true };

		type Hit = { playerId: Id<'players'>; slug: string; raw: RawCharacter; lastModified?: string };
		const hits: Hit[] = [];
		let notModified = 0;
		let notFound = 0;
		let failed = 0;

		await mapLimit(st.entries, CONCURRENCY, async (e: PollEntry) => {
			try {
				const r = await get(['profile', 'wow', 'character', e.slug], profileNs(), e.lastModified);
				if (r.status === 304) return notModified++;
				if (r.status === 404) return notFound++;
				const raw = await getCharacterParts(e.slug, r.body);
				hits.push({ playerId: e.playerId, slug: e.slug, raw, lastModified: r.lastModified });
			} catch (err) {
				failed++;
				console.warn(`poll ${e.slug}:`, err);
			}
		});

		if (hits.length === 0) return { checked: st.entries.length, changed: 0, notModified, notFound, failed };

		// ikone: najprej predpomnilnik, manjkajoče od Blizzarda (samo enkrat na predmet za vedno)
		const ids = [...new Set(hits.flatMap((h) => itemIds(h.raw)))];
		const icons = new Map<number, string | null>();
		const cached: { itemId: number; url: string | null }[] = await ctx.runQuery(internal.poll.cachedIcons, { ids });
		for (const c of cached) icons.set(c.itemId, c.url);
		const missing = ids.filter((id) => !icons.has(id));
		const newIcons: { itemId: number; url: string | null }[] = [];
		await mapLimit(missing, CONCURRENCY, async (itemId) => {
			try {
				const url = await itemIcon(itemId);
				icons.set(itemId, url);
				newIcons.push({ itemId, url });
			} catch {
				/* poskusi ob naslednji spremembi */
			}
		});

		// talenti: največji rang + ikona (enkrat na talent) in drevesa razreda (enkrat na razred)
		const refs = new Map(hits.flatMap((h) => talentRefs(h.raw)).map((r) => [r.talentId, r.spellId]));
		const classIds = [...new Set(hits.map((h) => Number(h.raw.profile?.character_class?.id ?? 0)).filter(Boolean))];
		const tc = await ctx.runQuery(internal.poll.cachedTalents, { talentIds: [...refs.keys()], classIds });
		const tInfo = new Map(tc.talents.map((t) => [t.talentId, { maxRank: t.maxRank, icon: t.icon }]));
		const specsByClass = new Map(tc.specs.map((x) => [x.classId, x.specs]));
		const newTalents: TalentRow[] = [];
		await mapLimit([...refs].filter(([id]) => !tInfo.has(id)), CONCURRENCY, async ([talentId, spellId]) => {
			try {
				const info = await talentInfo(talentId, spellId);
				tInfo.set(talentId, info);
				newTalents.push({ talentId, ...info });
			} catch {
				/* naslednjič */
			}
		});
		const newSpecs: SpecRow[] = [];
		for (const classId of classIds.filter((c) => !specsByClass.has(c))) {
			const specs = await classSpecs(classId).catch(() => null);
			if (specs?.length) {
				specsByClass.set(classId, specs);
				newSpecs.push({ classId, specs });
			}
		}

		const updates = hits.map((h) => {
			const { summary, details } = normalize(h.slug, h.raw, icons, {
				info: tInfo,
				specs: specsByClass.get(Number(h.raw.profile?.character_class?.id ?? 0)) ?? null
			});
			return { playerId: h.playerId, lastModified: h.lastModified, summary, details };
		});
		await ctx.runMutation(internal.poll.apply, { updates, newIcons, newTalents, newSpecs });
		return { checked: st.entries.length, changed: hits.length, notModified, notFound, failed };
	}
});

/** Ena mutacija na zagon (samo ob spremembah): povzetek, podrobnosti, zgodovina, dogodki, pollState. */
export const apply = internalMutation({
	args: {
		updates: v.array(
			v.object({
				playerId: v.id('players'),
				lastModified: v.optional(v.string()),
				summary: v.object(summaryFields),
				details: v.object(detailFields)
			})
		),
		newIcons: v.array(v.object({ itemId: v.number(), url: v.union(v.string(), v.null()) })),
		newTalents: v.optional(v.array(v.object({ talentId: v.number(), maxRank: v.number(), icon: v.union(v.string(), v.null()) }))),
		newSpecs: v.optional(v.array(v.object({ classId: v.number(), specs: v.array(v.object({ id: v.number(), name: v.string() })) })))
	},
	handler: async (ctx, { updates, newIcons, newTalents = [], newSpecs = [] }) => {
		for (const t of newTalents) {
			const exists = await ctx.db
				.query('talentInfo')
				.withIndex('by_talent', (q) => q.eq('talentId', t.talentId))
				.unique();
			if (!exists) await ctx.db.insert('talentInfo', t);
		}
		for (const c of newSpecs) {
			const exists = await ctx.db
				.query('classSpecs')
				.withIndex('by_class', (q) => q.eq('classId', c.classId))
				.unique();
			if (!exists) await ctx.db.insert('classSpecs', c);
		}
		const now = Date.now();

		for (const icon of newIcons) {
			const exists = await ctx.db
				.query('itemIcons')
				.withIndex('by_item', (q) => q.eq('itemId', icon.itemId))
				.unique();
			if (!exists) await ctx.db.insert('itemIcons', icon);
		}

		const ps = await ctx.db
			.query('pollState')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		const entries = ps ? [...ps.entries] : [];
		let newEvents = 0;

		for (const u of updates) {
			const player = await ctx.db.get(u.playerId);
			if (!player) continue; // medtem odstranjen

			const prev = await ctx.db
				.query('summaries')
				.withIndex('by_player', (q) => q.eq('playerId', u.playerId))
				.unique();
			const prevDetails = await ctx.db
				.query('details')
				.withIndex('by_player', (q) => q.eq('playerId', u.playerId))
				.unique();

			if (prev) await ctx.db.patch(prev._id, { ...u.summary, updatedAt: now });
			else await ctx.db.insert('summaries', { playerId: u.playerId, ...u.summary, updatedAt: now });
			if (prevDetails) await ctx.db.patch(prevDetails._id, { ...u.details, updatedAt: now });
			else await ctx.db.insert('details', { playerId: u.playerId, ...u.details, updatedAt: now });

			// zgodovina samo ob spremembi številk
			const s = u.summary;
			const row = { level: s.level, ilvl: s.ilvlEquipped, kills: s.kills, deaths: s.deaths, quests: s.quests, honorableKills: s.honorableKills };
			const changed =
				!prev ||
				prev.level !== row.level ||
				prev.ilvlEquipped !== row.ilvl ||
				prev.kills !== row.kills ||
				prev.deaths !== row.deaths ||
				prev.quests !== row.quests ||
				prev.honorableKills !== row.honorableKills;
			if (changed) await ctx.db.insert('history', { playerId: u.playerId, at: now, ...row });

			// dogodki (za Discord in feed) – samo, če imamo prejšnje stanje
			if (prev && prev.lastLogin !== s.lastLogin) {
				const prevIds = new Set(((prevDetails?.equipment ?? []) as Item[]).map((i) => i.itemId));
				const newItems = (u.details.equipment as Item[])
					.filter((i) => !prevIds.has(i.itemId))
					.map((i) => ({ name: i.name, quality: i.quality, slot: i.slot, ilvl: i.ilvl, icon: i.icon }));
				newEvents++;
				await ctx.db.insert('events', {
					playerId: u.playerId,
					at: now,
					type: 'session',
					payload: {
						name: `${s.name} ${s.surname}`.trim(),
						classId: s.classId,
						avatar: s.avatar ?? null,
						level: { from: prev.level, to: s.level },
						ilvl: { from: prev.ilvlEquipped, to: s.ilvlEquipped },
						kills: s.kills - prev.kills,
						deaths: s.deaths - prev.deaths,
						quests: s.quests - prev.quests,
						honorableKills: s.honorableKills - prev.honorableKills,
						newItems,
						race: s.race,
						className: s.className,
						faction: s.faction,
						guild: s.guild ?? null,
						ilvlAverage: { from: prev.ilvlAverage, to: s.ilvlAverage },
						achievementPoints: s.achievementPoints - prev.achievementPoints,
						counters: counterDeltas(prev.counters, s.counters),
						professions: professionUps(prevDetails?.professions, u.details.professions),
						...(prev.talentBuild && s.talentBuild && prev.talentBuild !== s.talentBuild
							? { talentBuild: { from: prev.talentBuild, to: s.talentBuild }, talentSpec: s.talentSpec ?? null }
							: {})
					}
				});
			}

			const idx = entries.findIndex((e) => e.playerId === u.playerId);
			if (idx >= 0) entries[idx] = { ...entries[idx], lastModified: u.lastModified, lastLogin: s.lastLogin };
		}

		if (ps) await ctx.db.patch(ps._id, { entries });
		// novi dogodki -> Discord objava takoj (ločena akcija, ne blokira pollerja)
		if (newEvents) await ctx.scheduler.runAfter(0, internal.discord.postPending, {});
	}
});
