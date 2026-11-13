// WoW constants, formatting and the site's (questionable) sense of humor.

const CLASS_COLORS: Record<number, string> = {
	1: '#c69b6d', // Warrior
	2: '#f48cba', // Paladin
	3: '#aad372', // Hunter
	4: '#fff468', // Rogue
	5: '#ffffff', // Priest
	6: '#c41e3a', // Death Knight
	7: '#0070dd', // Shaman
	8: '#3fc7eb', // Mage
	9: '#8788ee', // Warlock
	10: '#00ff98', // Monk
	11: '#ff7c0a', // Druid
	12: '#a330c9', // Demon Hunter
	13: '#33937f' // Evoker
};
export const classColor = (id: number | undefined) => (id && CLASS_COLORS[id]) || '#e5d9b6';

const QUALITY: Record<string, string> = {
	POOR: '#9d9d9d',
	COMMON: '#ffffff',
	UNCOMMON: '#1eff00',
	RARE: '#0070dd',
	EPIC: '#a335ee',
	LEGENDARY: '#ff8000',
	ARTIFACT: '#e6cc80',
	HEIRLOOM: '#00ccff'
};
export const qualityColor = (q: string) => QUALITY[q] ?? '#ffffff';

/** Gear slots in in-game order. */
export const SLOTS_LEFT = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST'];
export const SLOTS_RIGHT = [
	'HANDS',
	'WAIST',
	'LEGS',
	'FEET',
	'FINGER_1',
	'FINGER_2',
	'TRINKET_1',
	'TRINKET_2'
];
export const SLOTS_BOTTOM = ['MAIN_HAND', 'OFF_HAND', 'RANGED'];
export const SLOT_LABELS: Record<string, string> = {
	HEAD: 'Head',
	NECK: 'Neck',
	SHOULDER: 'Shoulders',
	BACK: 'Back',
	CHEST: 'Chest',
	SHIRT: 'Shirt',
	TABARD: 'Tabard',
	WRIST: 'Wrists',
	HANDS: 'Hands',
	WAIST: 'Waist',
	LEGS: 'Legs',
	FEET: 'Feet',
	FINGER_1: 'Ring',
	FINGER_2: 'Ring',
	TRINKET_1: 'Trinket',
	TRINKET_2: 'Trinket',
	MAIN_HAND: 'Main Hand',
	OFF_HAND: 'Off Hand',
	RANGED: 'Ranged'
};
export const EMPTY_SLOT_JOKES: Record<string, string> = {
	HEAD: 'bare skull, very aerodynamic',
	NECK: 'naked neck, vampires welcome',
	SHOULDER: 'no pauldrons, no dignity',
	SHIRT: 'shirtless. bold.',
	TABARD: 'no tabard, no loyalty',
	FINGER_1: 'single and ringless',
	FINGER_2: 'still single',
	TRINKET_1: 'no trinkets, no luck',
	TRINKET_2: 'pockets full of lint',
	OFF_HAND: 'free hand for... reasons'
};

export { COUNTER_LABELS } from '../convex/lib/humor.js';

export { deathTitle, kdQuip } from '../convex/lib/humor.js';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function ago(ms: number | null | undefined): string {
	if (!ms) return '–';
	const s = (ms - Date.now()) / 1000;
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 31536000],
		['month', 2592000],
		['week', 604800],
		['day', 86400],
		['hour', 3600],
		['minute', 60]
	];
	for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
	return 'just now';
}

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n: number | null | undefined, digits = 0) =>
	n == null
		? '–'
		: digits
			? n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
			: nf.format(Math.round(n));

/** Blizzard's forever-eu icon CDN 403s on some files; retail CDN has the same file ids. */
export function iconFallback(e: Event) {
	const img = e.currentTarget as HTMLImageElement;
	if (img.src.includes('/forever-')) img.src = img.src.replace(/\/forever-(\w+)\//, '/$1/');
}

/** Labels for the admin visibility switches. */
export const FIELD_LABELS: Record<string, string> = {
	name: 'Name',
	surname: 'Surname',
	slug: 'Profile link',
	level: 'Level',
	classId: 'Class (color)',
	className: 'Class',
	race: 'Race',
	faction: 'Faction',
	guild: 'Guild',
	avatar: 'Portrait',
	ilvlEquipped: 'Item level (equipped)',
	experience: 'Experience',
	gender: 'Gender',
	ruleset: 'Ruleset',
	ilvlAverage: 'Item level (best owned)',
	achievementPoints: 'Achievement points',
	lastLogin: 'Last seen + Tavern Gossip feed (reveals log-out times)',
	kills: 'Kills',
	deaths: 'Deaths',
	quests: 'Quests',
	honorableKills: 'Honorable kills',
	counters: 'Fun counters (food, falls, hearth…)',
	talents: 'Talent build',
	equipment: 'Gear & tooltips',
	stats: 'Character stats',
	professions: 'Professions',
	allStats: 'Every Blizzard statistic',
	history: 'Progress history (charts)',
	runs: 'Dungeon runs list (dungeon, party, duration, who snitched)',
	runDetails: 'Dungeon run meter (damage, healing, bosses, spells, awards)',
	runDeaths: 'Dungeon run deaths (counts + last 10 hits before the floor)',
	runLoot: 'Dungeon run loot (who grabbed what)'
};

/** Začetek 7-dnevnega okna, zaokrožen na uro (stabilni argumenti -> Convex lahko predpomni poizvedbo). */
export const weekSince = () => Math.floor(Date.now() / 3_600_000) * 3_600_000 - 7 * 24 * 3_600_000;
