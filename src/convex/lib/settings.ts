import type { QueryCtx } from '../_generated/server.js';

/** Polja, ki so privzeto javna (admin jih lahko spremeni v nastavitvah). */
export const DEFAULT_PUBLIC_FIELDS = [
	'name',
	'surname',
	'slug',
	'level',
	'classId',
	'className',
	'race',
	'faction',
	'guild',
	'avatar',
	'ilvlEquipped'
];

/** Identiteta (ime, priimek, povezava) je vedno javna in ni v seznamu stikal. */
export const IDENTITY_FIELDS = ['name', 'surname', 'slug'];

/** Vsa polja povzetka, ki jih lahko admin označi kot javna. */
export const ALL_SUMMARY_FIELDS = [
	...DEFAULT_PUBLIC_FIELDS.filter((f) => !IDENTITY_FIELDS.includes(f)),
	'experience',
	'gender',
	'ruleset',
	'ilvlAverage',
	'achievementPoints',
	'lastLogin',
	'kills',
	'deaths',
	'quests',
	'honorableKills',
	'counters',
	'talents'
];

/** Sekcije strani lika, ki so lahko javne. */
export const DETAIL_SECTIONS = ['equipment', 'stats', 'professions', 'counters', 'allStats', 'history'];

export const DEFAULT_SETTINGS = {
	pollIntervalSec: 60,
	publicFields: DEFAULT_PUBLIC_FIELDS,
	paused: false
};

/** Vsa polja, ki jih lahko admin vklopi (splet ali Discord). */
export const ALL_FIELDS = [...ALL_SUMMARY_FIELDS, ...DETAIL_SECTIONS.filter((f) => !ALL_SUMMARY_FIELDS.includes(f))];

export async function getSettings(ctx: QueryCtx) {
	const doc = await ctx.db
		.query('settings')
		.withIndex('by_key', (q) => q.eq('key', 'main'))
		.unique();
	const base = doc ?? { ...DEFAULT_SETTINGS, key: 'main' as const };
	// Discord je zaseben kanal prijateljev -> privzeto vse
	return { ...base, discordFields: doc?.discordFields ?? ALL_FIELDS };
}
