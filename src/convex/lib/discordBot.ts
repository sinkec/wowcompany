// Odgovori na slash ukaze (čiste funkcije -> testabilno). Vse sledi Discord vidnosti (settings.discordFields).
import { CLASS_COLORS, QUALITY_EMOJI } from './discordEmbed.js';
import { COUNTER_LABELS, deathTitle, kdQuip } from './humor.js';

export type BotSummary = {
	slug: string;
	name: string;
	surname: string;
	level: number;
	experience: number;
	classId: number;
	className: string;
	race: string;
	faction: string;
	gender: string;
	guild?: string;
	ruleset?: string;
	ilvlEquipped: number;
	ilvlAverage: number;
	achievementPoints: number;
	avatar?: string;
	lastLogin?: number;
	kills: number;
	deaths: number;
	quests: number;
	honorableKills: number;
	counters?: Record<string, number>;
	talentBuild?: string;
	talentSpec?: string;
};
export type BotDetails = {
	render?: string;
	equipment?: { name: string; quality: string; slot: string; ilvl: number }[];
	stats?: Record<string, number | string> | null;
	professions?: { name: string; primary: boolean; skill: number; max: number }[];
	allStats?: unknown[];
	talents?: { name: string; spent: number; talents: { name: string; rank: number; maxRank: number | null }[] }[];
};
/** Prvi zapis zgodovine + število vseh sprememb. */
export type BotHistory = { firstAt: number; firstLevel: number; changes: number };

type Embed = Record<string, unknown>;
const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`; // Discord sam prikaže "pred 2 urama"
const fullName = (s: { name: string; surname: string }) => `${s.name} ${s.surname}`.trim();
const color = (ok: (f: string) => boolean, classId?: number) => (ok('classId') && classId && CLASS_COLORS[classId]) || 0xe5d9b6;

function identity(s: BotSummary, ok: (f: string) => boolean) {
	const who = [ok('level') ? `Level ${s.level}` : null, ok('gender') ? s.gender : null, ok('race') ? s.race : null, ok('className') ? s.className : null]
		.filter(Boolean)
		.join(' ');
	return [who || null, ok('guild') && s.guild ? `<${s.guild}>` : null, ok('faction') ? s.faction : null, ok('ruleset') ? s.ruleset : null]
		.filter(Boolean)
		.join(' · ');
}

// ------------------------------------------------------------------ /roster

export function rosterEmbed(list: BotSummary[], fields: string[], site?: string): Embed {
	const ok = (f: string) => fields.includes(f);
	const sorted = [...list].sort((a, b) => (ok('level') ? b.level - a.level : 0) || fullName(a).localeCompare(fullName(b)));
	const lines = sorted.map((s) => {
		const name = site ? `[${fullName(s)}](${site}/c/${s.slug})` : fullName(s);
		const bits = [
			ok('level') ? `**${s.level}**` : null,
			[ok('race') ? s.race : null, ok('className') ? s.className : null].filter(Boolean).join(' ') || null,
			ok('ilvlEquipped') ? `ilvl ${s.ilvlEquipped}` : null,
			ok('kills') ? `🗡️ ${fmt(s.kills)}` : null,
			ok('deaths') ? `💀 ${fmt(s.deaths)}` : null,
			ok('lastLogin') && s.lastLogin ? `seen ${ts(s.lastLogin)}` : null
		].filter(Boolean);
		return `${name}${bits.length ? ' — ' + bits.join(' · ') : ''}`;
	});
	return {
		title: `The Roster (${list.length} questionable heroes)`,
		description: lines.join('\n').slice(0, 4000) || 'Nobody. Even the Scourge has more friends.',
		color: 0xffd100,
		footer: { text: 'WowCompany · /hero <name> for the gory details' }
	};
}

// ------------------------------------------------------------------ /hero

export function heroEmbed(s: BotSummary, d: BotDetails | null, history: BotHistory | null, fields: string[], site?: string): Embed {
	const ok = (f: string) => fields.includes(f);
	const out: { name: string; value: string; inline?: boolean }[] = [];
	const inline = (name: string, value: string) => out.push({ name, value, inline: true });

	if (ok('ilvlEquipped')) inline('ilvl', ok('ilvlAverage') ? `${s.ilvlEquipped} *(best ${s.ilvlAverage})*` : `${s.ilvlEquipped}`);
	else if (ok('ilvlAverage')) inline('Best ilvl', `${s.ilvlAverage}`);
	if (ok('kills')) inline('Kills', fmt(s.kills));
	if (ok('deaths')) inline('Deaths', `${fmt(s.deaths)} 💀`);
	if (ok('kills') && ok('deaths')) {
		const kd = s.kills / Math.max(1, s.deaths);
		inline('K/D', `${fmt(kd, 1)} · *${kdQuip(kd)}*`);
	}
	if (ok('quests')) inline('Errands', fmt(s.quests));
	if (ok('honorableKills')) inline('HKs', fmt(s.honorableKills));
	if (ok('achievementPoints')) inline('Cheevos', `${fmt(s.achievementPoints)} pts`);
	if (ok('experience')) inline('XP', fmt(s.experience));
	if (ok('lastLogin') && s.lastLogin) inline('Last seen', ts(s.lastLogin));

	if (ok('talents') && s.talentBuild) {
		const top = [...(d?.talents ?? [])].sort((a, b) => b.spent - a.spent)[0];
		const picks = (top?.talents ?? [])
			.slice(0, 5)
			.map((t) => `${t.name} ${t.rank}${t.maxRank ? `/${t.maxRank}` : ''}`)
			.join(' · ');
		out.push({ name: 'Talents', value: `**${s.talentSpec ?? '?'}** ${s.talentBuild}${picks ? `\n${picks}` : ''}` });
	}

	if (ok('professions') && d?.professions?.length)
		out.push({ name: 'Day jobs', value: d.professions.map((p) => `${p.name} **${p.skill}**/${p.max}`).join('\n') });

	if (ok('equipment') && d?.equipment?.length) {
		const best = [...d.equipment].filter((i) => i.slot !== 'Shirt' && i.slot !== 'Tabard').sort((a, b) => b.ilvl - a.ilvl);
		out.push({
			name: `Shiniest gear (${d.equipment.length} pieces worn)`,
			value: best
				.slice(0, 5)
				.map((i) => `${QUALITY_EMOJI[i.quality] ?? '▫️'} ${i.name} *(${i.slot}, ${i.ilvl})*`)
				.join('\n')
		});
	}

	if (ok('stats') && d?.stats) {
		const n = (k: string) => Number(d.stats?.[k] ?? 0);
		out.push({
			name: 'Stats',
			value: [
				`HP ${fmt(n('health'))}`,
				`Str ${n('strength')}`,
				`Agi ${n('agility')}`,
				`Sta ${n('stamina')}`,
				`Int ${n('intellect')}`,
				`Spi ${n('spirit')}`,
				`Armor ${fmt(n('armor'))}`,
				`AP ${n('attackPower')}`,
				`SP ${n('spellPower')}`,
				`Crit ${fmt(Math.max(n('meleeCrit'), n('spellCrit'), n('rangedCrit')), 1)}%`
			].join(' · ')
		});
	}

	if (ok('counters') && s.counters) {
		const top = Object.entries(s.counters)
			.filter(([k, v]) => v > 0 && !['kills', 'deaths', 'quests', 'killing_blows'].includes(k))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([k, v]) => `${COUNTER_LABELS[k] ?? k}: **${fmt(v)}**`);
		if (top.length) out.push({ name: 'Shenanigans', value: top.join('\n') });
	}

	if (ok('history') && history && history.changes > 1) {
		const lv = ok('level') ? `level ${history.firstLevel} → ${s.level}` : `${history.changes} recorded changes`;
		out.push({ name: 'Since we started watching', value: `${ts(history.firstAt)}: ${lv}` });
	}

	if (ok('allStats') && d?.allStats?.length && site)
		out.push({ name: 'Every stat ever', value: `${d.allStats.length} more numbers on the [website](${site}/c/${s.slug}).` });

	const id = identity(s, ok);
	const title = ok('deaths') ? `“${deathTitle(s.deaths)}”` : null;
	return {
		author: { name: fullName(s), ...(site ? { url: `${site}/c/${s.slug}` } : {}), ...(ok('avatar') && s.avatar ? { icon_url: s.avatar } : {}) },
		description: [id ? `*${id}*` : null, title].filter(Boolean).join('\n') || 'Classified. The Guild Master likes secrets.',
		color: color(ok, s.classId),
		fields: out.slice(0, 25),
		...(ok('avatar') && d?.render ? { image: { url: d.render } } : ok('avatar') && s.avatar ? { thumbnail: { url: s.avatar } } : {}),
		footer: { text: 'WowCompany · data refreshes when they log out' }
	};
}

// ------------------------------------------------------------------ /leaderboard

type Board = { key: string; title: string; note: string; field: string; value: (s: BotSummary) => number; digits?: number };

export const BOARDS: Board[] = [
	{ key: 'level', title: 'Highest Level', note: 'touch grass? never heard of her', field: 'level', value: (s) => s.level },
	{ key: 'ilvl', title: 'Shiniest Gear', note: 'equipped item level', field: 'ilvlEquipped', value: (s) => s.ilvlEquipped },
	{ key: 'kills', title: 'Serial Killer', note: 'things murdered', field: 'kills', value: (s) => s.kills },
	{ key: 'deaths', title: 'Professional Corpse', note: 'deaths, lovingly counted', field: 'deaths', value: (s) => s.deaths },
	{ key: 'kd', title: 'Hard to Kill', note: 'kills per death', field: 'kd', value: (s) => s.kills / Math.max(1, s.deaths), digits: 1 },
	{ key: 'quests', title: 'Errand Boy', note: 'quests done for strangers', field: 'quests', value: (s) => s.quests },
	{ key: 'hks', title: 'Honor? What Honor', note: 'honorable kills', field: 'honorableKills', value: (s) => s.honorableKills },
	{ key: 'cheevos', title: 'Cheevo Hunter', note: 'achievement points', field: 'achievementPoints', value: (s) => s.achievementPoints },
	{ key: 'falls', title: "Gravity's Favorite", note: 'deaths by falling', field: 'counters', value: (s) => s.counters?.falling_deaths ?? 0 },
	{ key: 'food', title: 'Bottomless Pit', note: 'food eaten', field: 'counters', value: (s) => s.counters?.food ?? 0 },
	{ key: 'drinks', title: 'Functional Alcoholic', note: 'drinks consumed', field: 'counters', value: (s) => s.counters?.drinks ?? 0 },
	{ key: 'hearth', title: 'Homesick Little Baby', note: 'hearthstone uses', field: 'counters', value: (s) => s.counters?.hearthed ?? 0 },
	{ key: 'need', title: 'Greedy Bastard', note: 'NEED rolls on loot', field: 'counters', value: (s) => s.counters?.need_rolls ?? 0 },
	{ key: 'fish', title: 'Fish Whisperer', note: "fish caught. we don't ask.", field: 'counters', value: (s) => s.counters?.fish ?? 0 },
	{ key: 'bandages', title: 'Field Medic', note: 'bandages slapped on', field: 'counters', value: (s) => s.counters?.bandages ?? 0 }
];

/** Ali je lestvica dovoljena (K/D potrebuje oboje). */
export const boardAllowed = (b: Board, fields: string[]) =>
	b.field === 'kd' ? fields.includes('kills') && fields.includes('deaths') : fields.includes(b.field);

export function leaderboardEmbed(key: string, list: BotSummary[], fields: string[], site?: string): Embed | null {
	const b = BOARDS.find((x) => x.key === key);
	if (!b || !boardAllowed(b, fields)) return null;
	const medals = ['🥇', '🥈', '🥉'];
	const rows = list
		.map((s) => ({ s, v: b.value(s) }))
		.filter((r) => r.v > 0)
		.sort((a, b2) => b2.v - a.v)
		.slice(0, 10)
		.map((r, i) => `${medals[i] ?? `\`${i + 1}.\``} ${site ? `[${fullName(r.s)}](${site}/c/${r.s.slug})` : fullName(r.s)} — **${fmt(r.v, b.digits ?? 0)}**`);
	return {
		title: b.title,
		description: `*${b.note}*\n\n${rows.join('\n') || 'Nobody qualifies. Pathetic.'}`,
		color: 0xffd100,
		footer: { text: 'WowCompany · leaderboards of glory & shame' }
	};
}

/** Definicije ukazov za registracijo pri Discordu. */
export const COMMANDS = [
	{ name: 'roster', description: 'Everyone in the company, ranked and judged', type: 1 },
	{
		name: 'hero',
		description: "One hero's gear, stats and shame",
		type: 1,
		options: [{ type: 3, name: 'name', description: 'Hero name (start typing)', required: true, autocomplete: true }]
	},
	{
		name: 'leaderboard',
		description: 'Leaderboards of glory and shame',
		type: 1,
		options: [
			{
				type: 3,
				name: 'board',
				description: 'Which leaderboard',
				required: true,
				choices: BOARDS.map((b) => ({ name: `${b.title} (${b.note})`.slice(0, 100), value: b.key }))
			}
		]
	}
];
