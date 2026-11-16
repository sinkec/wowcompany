// Guild roster za predloge imen v obrazcu (1 klic na dan, en dokument).
import { v } from 'convex/values';
import { internal } from './_generated/api.js';
import { internalAction, internalMutation, query } from './_generated/server.js';
import { getViewer } from './lib/access.js';
import { sameFields } from './lib/same.js';
import { get as bnetGet, profileNs, useRegion } from './lib/blizzard.js';

const member = v.object({ name: v.string(), surname: v.string(), slug: v.string(), level: v.number(), classId: v.number() });

export const refresh = internalAction({
	args: {},
	handler: async (ctx): Promise<number> => {
		const guild = process.env.BLIZZARD_GUILD_SLUG;
		if (!guild) return 0;
		useRegion((await ctx.runQuery(internal.realms.current, {}))?.region);
		const r = await bnetGet(['data', 'wow', 'guild', guild, 'roster'], profileNs());
		if (r.status !== 200) return 0;
		const members = (r.body.members ?? [])
			.map((m: any) => ({
				name: String(m.character?.name ?? ''),
				surname: String(m.character?.surname ?? ''),
				slug: String(m.character?.slug ?? ''),
				level: Number(m.character?.level ?? 0),
				classId: Number(m.character?.playable_class?.id ?? 0)
			}))
			.filter((m: { slug: string }) => m.slug);
		await ctx.runMutation(internal.roster.save, { members });
		return members.length;
	}
});

export const save = internalMutation({
	args: { members: v.array(member) },
	handler: async (ctx, { members }) => {
		const now = Date.now();
		const doc = await ctx.db
			.query('guildRoster')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		// isti seznam -> brez zapisa velikega dokumenta (ne razveljavi roster.members pri odprtih obrazcih)
		if (!doc) await ctx.db.insert('guildRoster', { key: 'main', members, fetchedAt: now });
		else if (!sameFields(doc, { members }, ['members'])) await ctx.db.patch(doc._id, { members, fetchedAt: now });

		const meta = await ctx.db
			.query('guildRosterMeta')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		if (meta) await ctx.db.patch(meta._id, { count: members.length, fetchedAt: now });
		else await ctx.db.insert('guildRosterMeta', { key: 'main', count: members.length, fetchedAt: now });
	}
});

/** Za prijavljene: seznam članov guilda (filtrira se v brskalniku -> 1 branje namesto 1 na tipko). */
export const members = query({
	args: {},
	handler: async (ctx) => {
		if (!(await getViewer(ctx))) return [];
		const doc = await ctx.db
			.query('guildRoster')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		return doc?.members ?? [];
	}
});
