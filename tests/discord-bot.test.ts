// bun test — slash ukazi (/roster, /hero, /leaderboard) sledijo Discord vidnosti.
import { describe, expect, test } from 'bun:test';
import { BOARDS, COMMANDS, heroEmbed, leaderboardEmbed, rosterEmbed, type BotSummary } from '../src/convex/lib/discordBot.ts';

const S: BotSummary = {
	slug: 'chugga-zugga', name: 'Chugga', surname: 'Zugga', level: 36, experience: 12345, classId: 1, className: 'Warrior',
	race: 'Orc', faction: 'Horde', gender: 'Female', guild: 'zadna runda', ruleset: 'PvP', ilvlEquipped: 30, ilvlAverage: 32,
	achievementPoints: 77, avatar: 'https://x/avatar.jpg', lastLogin: 1_700_000_000_000, kills: 7519, deaths: 41, quests: 209,
	honorableKills: 39, counters: { food: 94, falling_deaths: 3, hearthed: 9 }
};
const D = {
	render: 'https://x/render.png',
	equipment: [{ name: 'Tusken Helm', quality: 'RARE', slot: 'Head', ilvl: 34 }],
	stats: { health: 1741, strength: 149, agility: 53, stamina: 140, intellect: 22, spirit: 58, armor: 1863, attackPower: 396, spellPower: 0, meleeCrit: 1.89 },
	professions: [{ name: 'Tailoring', primary: true, skill: 57, max: 150 }],
	allStats: [1, 2, 3]
};
const H = { firstAt: 1_690_000_000_000, firstLevel: 30, changes: 5 };
const ALL = ['level', 'classId', 'className', 'race', 'faction', 'guild', 'avatar', 'ilvlEquipped', 'experience', 'gender', 'ruleset',
	'ilvlAverage', 'achievementPoints', 'lastLogin', 'kills', 'deaths', 'quests', 'honorableKills', 'counters', 'equipment', 'stats',
	'professions', 'allStats', 'history'];
const text = (o: unknown) => {
	const { color: _c, ...rest } = o as Record<string, unknown>;
	return JSON.stringify(rest);
};
const hero = (fields: string[]) => text(heroEmbed(S, D, H, fields, 'https://site'));

/** Polje -> besedilo, ki se mora pojaviti v /hero, ko je vklopljeno. */
const HERO: Record<string, string> = {
	level: 'Level 36', gender: 'Female', race: 'Orc', className: 'Warrior', guild: '<zadna runda>', faction: 'Horde', ruleset: 'PvP',
	avatar: 'render.png', ilvlEquipped: '"ilvl"', ilvlAverage: 'Best ilvl', achievementPoints: '77 pts', experience: '12,345',
	lastLogin: '<t:1700000000:R>', kills: '7,519', deaths: 'Corpse Runner', quests: '209', honorableKills: '"HKs"',
	counters: 'Food stuffed', equipment: 'Tusken Helm', stats: 'Armor 1,863', professions: 'Tailoring', allStats: '3 more numbers',
	history: 'Since we started watching'
};

describe('/hero', () => {
	for (const [field, marker] of Object.entries(HERO)) {
		test(`${field}: vklopljeno -> vidno, izklopljeno -> skrito`, () => {
			const need = field === 'history' ? ['history'] : field === 'deaths' ? ['deaths'] : [field];
			expect(hero(need)).toContain(marker);
			expect(hero(ALL.filter((f) => f !== field))).not.toContain(marker);
		});
	}
	test('nič vklopljeno -> samo ime', () => {
		const t = hero([]);
		for (const m of Object.values(HERO)) expect(t).not.toContain(m);
		expect(t).toContain('Chugga Zugga');
	});
});

describe('/roster', () => {
	test('skrita polja ne uidejo', () => {
		const t = text(rosterEmbed([S], []));
		for (const leak of ['36', 'Orc', 'Warrior', '7,519', '💀', '<t:']) expect(t).not.toContain(leak);
		expect(t).toContain('Chugga Zugga');
	});
	test('vklopljena se pokažejo', () => {
		const t = text(rosterEmbed([S], ['level', 'race', 'className', 'ilvlEquipped', 'kills', 'deaths', 'lastLogin']));
		for (const m of ['**36**', 'Orc Warrior', 'ilvl 30', '7,519', '💀 41', '<t:1700000000:R>']) expect(t).toContain(m);
	});
});

describe('/leaderboard', () => {
	test('lestvica s skritim poljem je "classified" (null)', () => {
		for (const b of BOARDS) {
			const field = b.field === 'kd' ? 'kills' : b.field;
			expect(leaderboardEmbed(b.key, [S], ALL.filter((f) => f !== field))).toBeNull();
			expect(leaderboardEmbed(b.key, [S], ALL)).not.toBeNull();
		}
	});
	test('K/D potrebuje kills IN deaths', () => {
		expect(leaderboardEmbed('kd', [S], ['kills'])).toBeNull();
		expect(text(leaderboardEmbed('kd', [S], ['kills', 'deaths']))).toContain('183.4');
	});
	test('izbira lestvic v ukazu ustreza BOARDS (max 25)', () => {
		const choices = COMMANDS.find((c) => c.name === 'leaderboard')!.options![0].choices!;
		expect(choices.length).toBe(BOARDS.length);
		expect(choices.length).toBeLessThanOrEqual(25);
	});
});
