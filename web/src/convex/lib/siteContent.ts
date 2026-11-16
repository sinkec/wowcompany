// Vsebina naslovnice, ki jo Guild Master ureja v Office → Website → Home page: šale junakov v heroju
// (posamične + pogovori treh) in povezave na skupnost (Discord, Facebook …). Čista logika + privzete
// vrednosti – testi v tests/site-content.test.ts.
//
// Zamenjave v besedilu: {me} = junak, ki govori; {1} {2} {3} = junaki v vrstnem redu govorjenja
// (samo ime, brez priimka).

export const SOCIAL_KINDS = [
	'discord',
	'facebook',
	'youtube',
	'twitch',
	'x',
	'instagram',
	'tiktok',
	'reddit',
	'bluesky',
	'kick',
	'patreon',
	'website'
] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];
export type Social = { kind: SocialKind; url: string; label?: string };

export const MAX_LINE = 110;
export const MAX_QUIPS = 200;
export const MAX_CONVOS = 100;
export const MAX_SOCIALS = 12;

export const DEFAULT_QUIPS = [
	'Professional floor inspector.',
	'Has never once read the quest text.',
	'Pulls first, apologizes never.',
	'Blames the healer. Is the healer.',
	'Still looking for the Ironforge mailbox.',
	'Rolled Need on cloth. As a warrior.',
	'Dies in the fire, files a bug report.',
	'Their hearthstone has frequent flyer miles.',
	'Carries 40 grey items "just in case".',
	'Fell off the same bridge three times. Today.',
	'Asked "is this the way to Molten Core?" in Goldshire.',
	'Paid the repair bill with tears.',
	'Will trade feelings for gold.',
	'AFK since the last patch.',
	'The mobs fear me. The vendors love me.',
	'I am not lost. I am exploring aggressively.',
	'My DPS is low because I am pacing myself.',
	'Who needs a map when you have confidence?',
	'One more dungeon. Then bed. (lie)',
	'I can solo that. Probably. Hold my drink.',
	'I put the "fun" in "funeral".',
	'Talents? I clicked whatever was shiny.',
	'Brb, pet ran into the next room again.',
	'If I die, it was lag.',
	'I only stand in fire for the warmth.',
	'My bags are full of things I will never use.',
	'Spirit healer and I are on first-name terms.',
	'I tank with my face. It works. Mostly.',
	'Need before greed, greed before reason.',
	'Running back to my corpse is my cardio.'
];

export const DEFAULT_CONVOS: [string, string, string][] = [
	['Who pulled that?', 'Not me.', 'The bear did it. Definitely the bear.'],
	["Where's the healer?", 'Behind the pillar, eating.', 'Everyone stand behind the pillar then.'],
	['Ready?', 'Wait, I need to repair.', 'And I need to sell 40 grey items.'],
	['{3}, you have the key?', 'What key?', 'Great. Corpse run it is.'],
	['Wipe it.', "We're not wiping, {1}.", '...we wiped.'],
	["I'm out of mana.", "I'm out of patience.", "I'm out of the group."],
	['Nice crit, {2}!', 'Thanks, it hit me.', 'It was the boss crit. On you.'],
	['Which way?', 'Left!', 'We went left last time and three of us died.'],
	["Loot's mine, I needed it.", 'You are a mage. It is a shield.', 'It matches my robe.'],
	['Did anyone bring food?', 'I brought fish.', 'Raw fish. Of course you did.'],
	['Let me pull this one carefully.', '{1}, that was four packs.', 'Carefully, I said.'],
	["I'll tank.", "You're a priest.", 'And yet here we are.']
];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE);

/** Posamične šale iz besedila (ena na vrstico, prazne vrstice izpuščene). */
export function parseQuips(text: string): string[] {
	return [...new Set(text.split('\n').map(clean).filter(Boolean))].slice(0, MAX_QUIPS);
}

/** Pogovori iz besedila: bloki po tri vrstice, ločeni s prazno vrstico. Napaka = opis, kaj ni prav. */
export function parseConvos(text: string): {
	convos: [string, string, string][];
	error: string | null;
} {
	const blocks = text
		.split(/\n\s*\n/)
		.map((b) => b.split('\n').map(clean).filter(Boolean))
		.filter((b) => b.length);
	const bad = blocks.findIndex((b) => b.length !== 3);
	if (bad >= 0)
		return {
			convos: [],
			error: `Conversation ${bad + 1} ("${blocks[bad][0].slice(0, 40)}…") has ${blocks[bad].length} lines – every conversation needs exactly 3. Put an empty line between conversations.`
		};
	return { convos: blocks.slice(0, MAX_CONVOS) as [string, string, string][], error: null };
}

export function cleanSocials(rows: { kind: string; url: string; label?: string }[]): Social[] {
	return rows
		.filter(
			(r) =>
				(SOCIAL_KINDS as readonly string[]).includes(r.kind) &&
				/^https:\/\/[^\s]+$/.test(r.url.trim())
		)
		.slice(0, MAX_SOCIALS)
		.map((r) => ({
			kind: r.kind as SocialKind,
			url: r.url.trim().slice(0, 300),
			...(r.label?.trim() ? { label: r.label.trim().slice(0, 40) } : {})
		}));
}

/** Zamenjave v vrstici (glej zgoraj). `names` = imena v vrstnem redu govorjenja. */
export function fillLine(line: string, speaker: number, names: string[]) {
	return line
		.replace(/\{me\}/g, names[speaker] ?? '')
		.replace(/\{([123])\}/g, (_, n) => names[Number(n) - 1] ?? '');
}
