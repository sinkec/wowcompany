// Koledar druščine: prazniki iz igre (addon C_Calendar → Companion → POST /companion/calendar) in naši
// dogodki (Guild Master). Člani se prijavijo ("I'm in"). Discord: objava ob shranjevanju + opomnik uro
// prej (če je dogodek tako označen in je polje `calendar` za Discord vklopljeno), /events v botu.
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api.js';
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
import { canSeePrivate, getViewer, requireAdmin } from './lib/access.js';
import {
	REMIND_BEFORE_MS,
	cleanCompanyEvent,
	cleanGameEvents,
	eventEmbed,
	overlaps
} from './lib/calendar.js';
import type { DiscordConfig } from './lib/discordConfig.js';
import { sendWebhook } from './lib/discordWebhook.js';
import { getSettings } from './lib/settings.js';
import { siteBrand } from './site.js';

const DAY = 24 * 3600 * 1000;
/** Najdaljši dogodek (praznik) – za iskanje tistih, ki so se začeli pred oknom. */
const LONGEST = 40 * DAY;

/** Ali obiskovalec vidi naše dogodke (prazniki iz igre so vedno javni). */
async function seesCompany(ctx: QueryCtx) {
	if (await canSeePrivate(ctx)) return true;
	return (await getSettings(ctx)).publicFields.includes('calendar');
}

async function inWindow(ctx: QueryCtx, from: number, to: number, take = 300) {
	const rows = await ctx.db
		.query('calendarEvents')
		.withIndex('by_startAt', (q) => q.gte('startAt', from - LONGEST).lt('startAt', to))
		.take(take);
	return rows.filter((e) => overlaps(e, from, to));
}

function view(e: Doc<'calendarEvents'>, me: string | null, showGoing: boolean) {
	return {
		id: e._id,
		source: e.source,
		title: e.title,
		description: e.description,
		kind: e.kind,
		startAt: e.startAt,
		endAt: e.endAt,
		location: e.location ?? null,
		going: showGoing ? (e.going ?? []).map((g) => ({ name: g.name, slug: g.slug ?? null })) : [],
		imGoing: !!me && (e.going ?? []).some((g) => g.userId === me),
		discord: e.discord ?? false
	};
}
export type CalendarEvent = ReturnType<typeof view>;

/** Dogodki v oknu (mesec v koledarju). */
export const range = query({
	args: { from: v.number(), to: v.number() },
	handler: async (ctx, { from, to }) => {
		if (to - from > 62 * DAY) throw new ConvexError('Two months at most.');
		const [company, viewer] = await Promise.all([seesCompany(ctx), getViewer(ctx)]);
		const member = viewer?.role === 'admin' || viewer?.role === 'member';
		const rows = (await inWindow(ctx, from, to)).filter((e) => e.source === 'game' || company);
		return {
			events: rows.map((e) => view(e, viewer?.user._id ?? null, company)),
			canRsvp: member,
			hidden: !company
		};
	}
});

/** Naslednji dogodki (naslovnica, Discord). `from` zaokroži odjemalec (predpomnjenje). */
export const upcoming = query({
	args: { from: v.number(), limit: v.optional(v.number()), kinds: v.optional(v.array(v.string())) },
	handler: async (ctx, { from, limit, kinds }) => {
		const company = await seesCompany(ctx);
		const viewer = await getViewer(ctx);
		const rows = (await inWindow(ctx, from, from + 45 * DAY))
			.filter((e) => e.source === 'game' || company)
			.filter((e) => !kinds || kinds.includes(e.kind))
			.sort((a, b) => a.startAt - b.startAt);
		// naši dogodki imajo prednost pred prazniki (teh je lahko veliko hkrati)
		const n = Math.min(Math.max(limit ?? 5, 1), 20);
		const ours = rows.filter((e) => e.source === 'company');
		const picked = [...ours.slice(0, n), ...rows.filter((e) => e.source === 'game')]
			.slice(0, n)
			.sort((a, b) => a.startAt - b.startAt);
		return picked.map((e) => view(e, viewer?.user._id ?? null, company));
	}
});

/** Guild Master: naši dogodki (prihajajoči in zadnji mesec). */
export const forAdmin = query({
	args: { from: v.number() },
	handler: async (ctx, { from }) => {
		await requireAdmin(ctx);
		const rows = await ctx.db
			.query('calendarEvents')
			.withIndex('by_source_and_startAt', (q) =>
				q.eq('source', 'company').gte('startAt', from - 30 * DAY)
			)
			.take(200);
		const game = await ctx.db
			.query('calendarEvents')
			.withIndex('by_source_and_startAt', (q) => q.eq('source', 'game').gte('startAt', from))
			.take(100);
		return {
			events: rows.map((e) => ({
				...view(e, null, true),
				announcedAt: e.announcedAt ?? null,
				remindedAt: e.remindedAt ?? null
			})),
			gameCount: game.length,
			gameUpdatedAt: game.reduce((m, e) => Math.max(m, e.updatedAt), 0) || null
		};
	}
});

const eventArgs = {
	title: v.string(),
	description: v.string(),
	kind: v.string(),
	startAt: v.number(),
	endAt: v.number(),
	location: v.optional(v.string()),
	discord: v.boolean()
};

async function scheduleDiscord(ctx: MutationCtx, id: Id<'calendarEvents'>) {
	const e = await ctx.db.get('calendarEvents', id);
	if (!e) return;
	if (e.reminderJob) {
		const job = await ctx.db.system.get('_scheduled_functions', e.reminderJob);
		if (job?.state.kind === 'pending') await ctx.scheduler.cancel(e.reminderJob);
	}
	let reminderJob: Id<'_scheduled_functions'> | undefined;
	const now = Date.now();
	if (e.discord) {
		if (!e.announcedAt && e.endAt > now)
			await ctx.scheduler.runAfter(0, internal.calendar.post, { id, mode: 'new' });
		const remindAt = e.startAt - REMIND_BEFORE_MS;
		if (!e.remindedAt && remindAt > now)
			reminderJob = await ctx.scheduler.runAt(remindAt, internal.calendar.post, {
				id,
				mode: 'soon'
			});
	}
	await ctx.db.patch('calendarEvents', id, { reminderJob });
}

export const save = mutation({
	args: { id: v.optional(v.id('calendarEvents')), ...eventArgs },
	handler: async (ctx, { id, discord, ...input }) => {
		const viewer = await requireAdmin(ctx);
		const r = cleanCompanyEvent(input);
		if (!r.ok) throw new ConvexError(r.error);
		const now = Date.now();
		if (id) {
			const prev = await ctx.db.get('calendarEvents', id);
			if (!prev || prev.source !== 'company') throw new ConvexError('That event is gone.');
			// premaknjen začetek = nov opomnik
			const moved = prev.startAt !== r.event.startAt;
			await ctx.db.patch('calendarEvents', id, {
				...r.event,
				location: r.event.location,
				discord,
				updatedAt: now,
				...(moved ? { remindedAt: undefined } : {})
			});
			await scheduleDiscord(ctx, id);
			return id;
		}
		const newId = await ctx.db.insert('calendarEvents', {
			source: 'company',
			key: `c:${now}:${Math.random().toString(36).slice(2, 8)}`,
			...r.event,
			createdBy: viewer.user._id,
			going: [],
			discord,
			updatedAt: now
		});
		await scheduleDiscord(ctx, newId);
		return newId;
	}
});

export const remove = mutation({
	args: { id: v.id('calendarEvents') },
	handler: async (ctx, { id }) => {
		await requireAdmin(ctx);
		const e = await ctx.db.get('calendarEvents', id);
		if (!e) return null;
		if (e.reminderJob) {
			const job = await ctx.db.system.get('_scheduled_functions', e.reminderJob);
			if (job?.state.kind === 'pending') await ctx.scheduler.cancel(e.reminderJob);
		}
		await ctx.db.delete('calendarEvents', id);
		return null;
	}
});

/** Član: "I'm in" / "I'm out" (z glavnim junakom iz nastavitev). */
export const rsvp = mutation({
	args: { id: v.id('calendarEvents'), going: v.boolean() },
	handler: async (ctx, { id, going }) => {
		const viewer = await getViewer(ctx);
		if (viewer?.role !== 'admin' && viewer?.role !== 'member')
			throw new ConvexError('Members only. Join the company first.');
		const e = await ctx.db.get('calendarEvents', id);
		if (!e || e.source !== 'company') throw new ConvexError('That event is gone.');
		if (e.endAt < Date.now()) throw new ConvexError('That ship has sailed.');
		const uid = viewer.user._id;
		const rest = (e.going ?? []).filter((g) => g.userId !== uid);
		if (going) {
			const profile = await ctx.db
				.query('profiles')
				.withIndex('by_user', (q) => q.eq('userId', uid))
				.unique();
			const main = profile?.mainSlug
				? await ctx.db
						.query('players')
						.withIndex('by_slug', (q) => q.eq('slug', profile.mainSlug!))
						.unique()
				: await ctx.db
						.query('players')
						.withIndex('by_owner', (q) => q.eq('ownerUserId', uid))
						.first();
			const name =
				main?.displayName ??
				(profile ? `${profile.firstName} ${profile.lastName}`.trim() : null) ??
				viewer.user.name ??
				'Someone';
			rest.push({ userId: uid, name, ...(main ? { slug: main.slug } : {}) });
		}
		await ctx.db.patch('calendarEvents', id, { going: rest.slice(0, 80) });
		return null;
	}
});

// ------------------------------------------------------------------ iz igre (Companion)

const fail = (code: 'unauthorized' | 'bad_request', message: string): never => {
	throw new ConvexError({ code, message, retryAfter: null });
};

/** Companion: prazniki iz igre za okno [from, to) – zamenjajo prejšnje v tem oknu. */
export const ingestGame = internalMutation({
	args: {
		tokenHash: v.string(),
		from: v.number(),
		to: v.number(),
		events: v.array(
			v.object({
				title: v.string(),
				description: v.string(),
				kind: v.string(),
				startAt: v.number(),
				endAt: v.number()
			})
		)
	},
	handler: async (ctx, a) => {
		const device = await ctx.db
			.query('devices')
			.withIndex('by_token_hash', (q) => q.eq('tokenHash', a.tokenHash))
			.unique();
		if (!device || device.revokedAt) return fail('unauthorized', 'Unknown or revoked device.');
		if (a.to <= a.from || a.to - a.from > 100 * DAY) fail('bad_request', 'Bad window.');
		const clean = cleanGameEvents(a.events);
		const now = Date.now();
		const keep = new Set(clean.map((e) => e.key));
		let added = 0;
		for (const e of clean) {
			const prev = await ctx.db
				.query('calendarEvents')
				.withIndex('by_key', (q) => q.eq('key', e.key))
				.unique();
			if (prev) {
				if (prev.endAt !== e.endAt || prev.description !== e.description)
					await ctx.db.patch('calendarEvents', prev._id, {
						endAt: e.endAt,
						description: e.description,
						updatedAt: now
					});
			} else {
				await ctx.db.insert('calendarEvents', { source: 'game', ...e, updatedAt: now });
				added++;
			}
		}
		// odpovedani/premaknjeni prazniki v istem oknu
		let removed = 0;
		const old = await ctx.db
			.query('calendarEvents')
			.withIndex('by_source_and_startAt', (q) =>
				q.eq('source', 'game').gte('startAt', a.from).lt('startAt', a.to)
			)
			.take(300);
		for (const e of old)
			if (!keep.has(e.key)) {
				await ctx.db.delete('calendarEvents', e._id);
				removed++;
			}
		return { added, removed, total: clean.length };
	}
});

// ------------------------------------------------------------------ Discord

export const postData = internalQuery({
	args: { id: v.id('calendarEvents') },
	handler: async (ctx, { id }) => {
		const e = await ctx.db.get('calendarEvents', id);
		if (!e) return null;
		const fields = (await getSettings(ctx)).discordFields;
		return {
			event: e,
			allowed: fields.includes('calendar'),
			brand: await siteBrand(ctx)
		};
	}
});

export const markPosted = internalMutation({
	args: { id: v.id('calendarEvents'), mode: v.union(v.literal('new'), v.literal('soon')) },
	handler: async (ctx, { id, mode }) => {
		if (!(await ctx.db.get('calendarEvents', id))) return;
		await ctx.db.patch(
			'calendarEvents',
			id,
			mode === 'new' ? { announcedAt: Date.now() } : { remindedAt: Date.now() }
		);
	}
});

/** Objava (nov dogodek) ali opomnik (`soon`) v Discord kanal. */
export const post = internalAction({
	args: { id: v.id('calendarEvents'), mode: v.union(v.literal('new'), v.literal('soon')) },
	handler: async (ctx, { id, mode }): Promise<string> => {
		const cfg: DiscordConfig = await ctx.runQuery(internal.integrations.config, {});
		if (!cfg.webhookUrl) return 'no webhook';
		const d = await ctx.runQuery(internal.calendar.postData, { id });
		if (!d) return 'gone';
		const e = d.event;
		if (!d.allowed || !e.discord) return 'calendar hidden in Discord';
		if (mode === 'new' ? e.announcedAt : e.remindedAt) return 'already posted';
		const embed = eventEmbed(
			{ ...e, id: e._id, going: e.going ?? [] },
			mode,
			d.brand,
			process.env.SITE_URL
		);
		const r = await sendWebhook(cfg.webhookUrl, { embeds: [embed] });
		if (r.ok) {
			await ctx.runMutation(internal.calendar.markPosted, { id, mode });
			return 'posted';
		}
		if (r.retryAfter) {
			await ctx.scheduler.runAfter(Math.ceil(r.retryAfter * 1000) + 500, internal.calendar.post, {
				id,
				mode
			});
			return 'rate limited';
		}
		console.error('Discord webhook (event):', r.error);
		return r.error ?? 'failed';
	}
});
