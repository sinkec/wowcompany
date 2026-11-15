// Sestavljanje Discord embedov (čiste funkcije, brez Convex konteksta -> enostavno testiranje).
import { COUNTER_LABELS, sessionHeadline } from './humor.js';

export const CLASS_COLORS: Record<number, number> = {
	1: 0xc69b6d, 2: 0xf48cba, 3: 0xaad372, 4: 0xfff468, 5: 0xffffff, 6: 0xc41e3a, 7: 0x0070dd,
	8: 0x3fc7eb, 9: 0x8788ee, 10: 0x00ff98, 11: 0xff7c0a, 12: 0xa330c9, 13: 0x33937f
};
export const QUALITY_EMOJI: Record<string, string> = {
	POOR: '⬜', COMMON: '⬜', UNCOMMON: '🟩', RARE: '🟦', EPIC: '🟪', LEGENDARY: '🟧', ARTIFACT: '🟨', HEIRLOOM: '🩵'
};

/** Polja, ki se lahko pokažejo v objavi seje (ostala delujejo samo v slash ukazih). */
export const POST_FIELDS = [
	'lastLogin', 'level', 'classId', 'className', 'race', 'faction', 'guild', 'avatar', 'ilvlEquipped', 'ilvlAverage',
	'achievementPoints', 'kills', 'deaths', 'quests', 'honorableKills', 'counters', 'equipment', 'professions', 'talents'
];

/** Števci, ki imajo že svoje polje (ne ponavljamo jih med "shenanigans"). */
const COUNTERS_WITH_OWN_FIELD = new Set(['kills', 'deaths', 'quests', 'killing_blows']);

type Range = { from: number; to: number };

/** Dogodek seje, kot ga zapiše poller (novejša polja so neobvezna zaradi starejših dogodkov). */
export type Payload = {
	name: string;
	classId: number;
	avatar: string | null;
	level: Range;
	ilvl: Range;
	kills: number;
	deaths: number;
	quests: number;
	honorableKills: number;
	newItems: { name: string; quality: string; slot: string; ilvl: number }[];
	race?: string;
	className?: string;
	faction?: string;
	guild?: string | null;
	ilvlAverage?: Range;
	achievementPoints?: number;
	counters?: Record<string, number>;
	professions?: { name: string; from: number; to: number; max: number }[];
	talentBuild?: { from: string; to: string };
	talentSpec?: string | null;
};

/** Payload po Discord vidnosti: skrito = null (ne 0, da šale ne lažejo, npr. "didn't die once"). */
export type Shown = {
	name: string;
	classId: number | null;
	avatar: string | null;
	level: Range | null;
	ilvl: Range | null;
	kills: number | null;
	deaths: number | null;
	quests: number | null;
	honorableKills: number | null;
	newItems: Payload['newItems'];
	race: string | null;
	className: string | null;
	faction: string | null;
	guild: string | null;
	ilvlAverage: Range | null;
	achievementPoints: number | null;
	counters: Record<string, number> | null;
	professions: NonNullable<Payload['professions']> | null;
	talentBuild: { from: string; to: string } | null;
	talentSpec: string | null;
};

export function filterPayload(p: Payload, fields: string[]): Shown {
	const ok = new Set(fields);
	const pick = <T>(field: string, v: T | undefined): T | null => (ok.has(field) && v !== undefined ? v : null);
	return {
		name: p.name,
		classId: pick('classId', p.classId),
		avatar: pick('avatar', p.avatar),
		level: pick('level', p.level),
		ilvl: pick('ilvlEquipped', p.ilvl),
		kills: pick('kills', p.kills),
		deaths: pick('deaths', p.deaths),
		quests: pick('quests', p.quests),
		honorableKills: pick('honorableKills', p.honorableKills),
		newItems: ok.has('equipment') ? (p.newItems ?? []) : [],
		race: pick('race', p.race),
		className: pick('className', p.className),
		faction: pick('faction', p.faction),
		guild: pick('guild', p.guild ?? undefined),
		ilvlAverage: pick('ilvlAverage', p.ilvlAverage),
		achievementPoints: pick('achievementPoints', p.achievementPoints),
		counters: pick('counters', p.counters),
		professions: pick('professions', p.professions),
		talentBuild: pick('talents', p.talentBuild),
		talentSpec: pick('talents', p.talentSpec ?? undefined)
	};
}

const fmt = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

/** "Level 37 Orc Warrior · <guild> · Horde" iz vidnih delov. */
function identityLine(p: Shown): string {
	const who = [p.level ? `Level ${p.level.to}` : null, p.race, p.className].filter(Boolean).join(' ');
	return [who || null, p.guild ? `<${p.guild}>` : null, p.faction].filter(Boolean).join(' · ');
}

export function sessionEmbed(e: { id: string; at: number; slug: string | null; payload: Shown }) {
	const p = e.payload;
	const seed = [...e.id].reduce((a, c) => a + c.charCodeAt(0), 0);
	const site = process.env.SITE_URL;
	const fields: { name: string; value: string; inline?: boolean }[] = [];
	if (p.level && p.level.to > p.level.from) fields.push({ name: 'Level', value: `${p.level.from} → **${p.level.to}**`, inline: true });
	if (p.ilvl && p.ilvl.to !== p.ilvl.from) fields.push({ name: 'ilvl', value: `${p.ilvl.from} → **${p.ilvl.to}**`, inline: true });
	if (p.ilvlAverage && p.ilvlAverage.to !== p.ilvlAverage.from)
		fields.push({ name: 'Best ilvl', value: `${p.ilvlAverage.from} → **${p.ilvlAverage.to}**`, inline: true });
	if (p.kills) fields.push({ name: 'Kills', value: signed(p.kills), inline: true });
	if (p.deaths) fields.push({ name: 'Died', value: `${signed(p.deaths)} 💀`, inline: true });
	if (p.quests) fields.push({ name: 'Errands', value: signed(p.quests), inline: true });
	if (p.honorableKills) fields.push({ name: 'HKs', value: signed(p.honorableKills), inline: true });
	if (p.achievementPoints) fields.push({ name: 'Cheevos', value: `${signed(p.achievementPoints)} pts`, inline: true });
	if (p.professions?.length)
		fields.push({
			name: 'Day jobs',
			value: p.professions.map((x) => `${x.name} ${x.from} → **${x.to}**${x.max ? `/${x.max}` : ''}`).join('\n')
		});
	if (p.talentBuild)
		fields.push({
			name: 'Respec',
			value: `${p.talentBuild.from} → **${p.talentBuild.to}**${p.talentSpec ? ` (${p.talentSpec})` : ''} — *commitment issues*`
		});
	const shenanigans = Object.entries(p.counters ?? {})
		.filter(([k, v]) => v > 0 && !COUNTERS_WITH_OWN_FIELD.has(k))
		.map(([k, v]) => `${COUNTER_LABELS[k] ?? k} **${signed(v)}**`);
	if (shenanigans.length) fields.push({ name: 'Shenanigans', value: shenanigans.slice(0, 8).join('\n') });
	if (p.newItems.length) {
		const lines = p.newItems
			.slice(0, 8)
			.map((i) => `${QUALITY_EMOJI[i.quality] ?? '▫️'} ${i.name} *(${i.slot}, ilvl ${i.ilvl})*`);
		if (p.newItems.length > 8) lines.push(`…and ${p.newItems.length - 8} more pieces of junk`);
		fields.push({ name: 'New loot', value: lines.join('\n') });
	}
	const id = identityLine(p);
	return {
		author: { name: p.name, ...(p.avatar ? { icon_url: p.avatar } : {}), ...(site && e.slug ? { url: `${site}/c/${e.slug}` } : {}) },
		description: `**${p.name}** ${sessionHeadline(p, seed)}${id ? `\n*${id}*` : ''}`,
		color: (p.classId != null && CLASS_COLORS[p.classId]) || 0xe5d9b6,
		fields,
		...(p.avatar ? { thumbnail: { url: p.avatar } } : {}),
		footer: { text: 'Tavern Gossip · reported on logout' },
		timestamp: new Date(e.at).toISOString()
	};
}

/** Primer seje za "Send test post" – vsebuje vse, da se vidi učinek vsakega stikala. */
export const SAMPLE_PAYLOAD: Payload = {
	name: 'Testy McTestface',
	classId: 9,
	avatar: 'https://render.worldofwarcraft.com/eu/icons/56/134400.jpg',
	level: { from: 41, to: 42 },
	ilvl: { from: 30, to: 33 },
	kills: 1337,
	deaths: 7,
	quests: 12,
	honorableKills: 3,
	newItems: [
		{ name: 'Pants of Questionable Origin', quality: 'EPIC', slot: 'Legs', ilvl: 45 },
		{ name: 'Slightly Used Murloc Fin', quality: 'POOR', slot: 'Trinket', ilvl: 1 }
	],
	race: 'Undead',
	className: 'Warlock',
	faction: 'Horde',
	guild: 'zadna runda',
	ilvlAverage: { from: 32, to: 35 },
	achievementPoints: 10,
	counters: { food: 4, drinks: 9, falling_deaths: 1, hearthed: 2 },
	professions: [{ name: 'Tailoring', from: 57, to: 63, max: 150 }],
	talentBuild: { from: '5/22/0', to: '0/0/27' },
	talentSpec: 'Destruction'
};
