// Koledar: dogodki iz igre (praznik, sistemski – addon jih prebere iz C_Calendar, Companion pošlje) in
// naši dogodki (Guild Master v Office → Website → Events). Čista logika – testi v tests/calendar.test.ts.

export const EVENT_KINDS = ['dungeon', 'raid', 'pvp', 'leveling', 'social', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const GAME_KINDS = ['holiday', 'system'] as const;

export const KIND_LABEL: Record<string, string> = {
	dungeon: 'Dungeon',
	raid: 'Raid',
	pvp: 'PvP',
	leveling: 'Leveling',
	social: 'Social',
	other: 'Other',
	holiday: 'In-game holiday',
	system: 'Game'
};
export const KIND_EMOJI: Record<string, string> = {
	dungeon: '🗝️',
	raid: '🐉',
	pvp: '⚔️',
	leveling: '📈',
	social: '🍺',
	other: '📌',
	holiday: '🎉',
	system: '📣'
};

export const MAX_TITLE = 80;
export const MAX_DESC = 600;
const DAY = 24 * 3600 * 1000;
/** Opomnik v Discord tik pred začetkom. */
export const REMIND_BEFORE_MS = 60 * 60 * 1000;

export type CompanyEventInput = {
	title: string;
	description: string;
	kind: string;
	startAt: number;
	endAt: number;
	location?: string;
};

/** Preveri in počisti naš dogodek. Napaka = besedilo za Guild Mastra. */
export function cleanCompanyEvent(
	e: CompanyEventInput
): { ok: true; event: CompanyEventInput } | { ok: false; error: string } {
	const title = e.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
	if (title.length < 3) return { ok: false, error: 'A title, please. Three letters at least.' };
	if (!(EVENT_KINDS as readonly string[]).includes(e.kind))
		return { ok: false, error: 'Unknown event type.' };
	if (!Number.isFinite(e.startAt) || !Number.isFinite(e.endAt))
		return { ok: false, error: 'Start and end need a date and time.' };
	if (e.endAt < e.startAt) return { ok: false, error: 'It ends before it starts. Bold.' };
	if (e.endAt - e.startAt > 14 * DAY)
		return { ok: false, error: 'Two weeks at most. Nobody has that much free time.' };
	const location = e.location?.replace(/\s+/g, ' ').trim().slice(0, 60);
	return {
		ok: true,
		event: {
			title,
			description: e.description.trim().slice(0, MAX_DESC),
			kind: e.kind,
			startAt: e.startAt,
			endAt: e.endAt,
			...(location ? { location } : {})
		}
	};
}

export type GameEventInput = {
	title: string;
	description: string;
	kind: string;
	startAt: number;
	endAt: number;
};

/** Dogodki iz igre: samo prazniki in sistemska obvestila (nikoli igralčevi ali guildovi – zasebnost). */
export function cleanGameEvents(rows: GameEventInput[]) {
	const out = new Map<string, GameEventInput & { key: string }>();
	for (const r of rows) {
		if (!(GAME_KINDS as readonly string[]).includes(r.kind)) continue;
		const title = r.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
		if (!title || !Number.isFinite(r.startAt) || r.startAt <= 0) continue;
		const endAt = Number.isFinite(r.endAt) && r.endAt >= r.startAt ? r.endAt : r.startAt;
		if (endAt - r.startAt > 40 * DAY) continue;
		const key = gameKey(title, r.startAt);
		out.set(key, {
			key,
			title,
			description: r.description.replace(/\s+/g, ' ').trim().slice(0, MAX_DESC),
			kind: r.kind,
			startAt: r.startAt,
			endAt
		});
	}
	return [...out.values()].slice(0, 200);
}

/** Isti praznik z dveh računalnikov = en dogodek (začetek zaokrožen na uro: različni časovni pasovi). */
export const gameKey = (title: string, startAt: number) =>
	`g:${title.toLowerCase()}:${Math.round(startAt / 3_600_000)}`;

/** Ali se dogodek prekriva z oknom [from, to). */
export const overlaps = (e: { startAt: number; endAt: number }, from: number, to: number) =>
	e.startAt < to && e.endAt >= from;

// ------------------------------------------------------------------ Discord

type EmbedEvent = {
	id: string;
	title: string;
	description: string;
	kind: string;
	startAt: number;
	endAt: number;
	location?: string | null;
	going?: { name: string }[];
	source: 'game' | 'company';
};

const unix = (ms: number) => Math.floor(ms / 1000);
const KIND_COLOR: Record<string, number> = {
	dungeon: 0xffd100,
	raid: 0xa335ee,
	pvp: 0xc41e3a,
	leveling: 0x1eff00,
	social: 0xff7c0a,
	other: 0x9d9d9d,
	holiday: 0x3fc7eb,
	system: 0x9d9d9d
};

/** Ena vrstica dogodka: emoji, naslov, Discordov lokalni čas ("v 2 urah"). */
export const eventLine = (e: EmbedEvent) =>
	`${KIND_EMOJI[e.kind] ?? '📌'} **${e.title}** · <t:${unix(e.startAt)}:f> (<t:${unix(e.startAt)}:R>)` +
	(e.source === 'company' && e.going?.length ? ` · ${e.going.length} going` : '');

/** Objava novega dogodka ali opomnik (`soon`). */
export function eventEmbed(e: EmbedEvent, mode: 'new' | 'soon', brand: string, site?: string) {
	const going = e.going ?? [];
	return {
		title: `${KIND_EMOJI[e.kind] ?? '📌'} ${mode === 'soon' ? 'Starting soon: ' : ''}${e.title}`,
		...(site ? { url: `${site}/calendar?event=${e.id}` } : {}),
		description: [
			e.description || null,
			mode === 'new'
				? '*Sign up on the website. Or show up late and blame the flight master.*'
				: '*Repair, restock, and for the love of the Light, go to the toilet now.*'
		]
			.filter(Boolean)
			.join('\n\n'),
		color: KIND_COLOR[e.kind] ?? 0xffd100,
		fields: [
			{ name: 'When', value: `<t:${unix(e.startAt)}:F>\n<t:${unix(e.startAt)}:R>`, inline: true },
			{ name: 'Type', value: KIND_LABEL[e.kind] ?? e.kind, inline: true },
			...(e.location ? [{ name: 'Where', value: e.location, inline: true }] : []),
			...(going.length
				? [
						{
							name: `Going (${going.length})`,
							value: going
								.map((g) => g.name)
								.join(', ')
								.slice(0, 1000)
						}
					]
				: [])
		],
		footer: { text: `${brand} · calendar` }
	};
}

/** /events: naslednji dogodki (naši + prazniki iz igre). */
export function eventsListEmbed(events: EmbedEvent[], brand: string, site?: string) {
	const ours = events.filter((e) => e.source === 'company');
	const game = events.filter((e) => e.source === 'game');
	return {
		title: '📅 Coming up',
		...(site ? { url: `${site}/calendar` } : {}),
		color: 0xffd100,
		description:
			[
				ours.length ? `__Our events__\n${ours.map(eventLine).join('\n')}` : null,
				game.length ? `__In the game__\n${game.map(eventLine).join('\n')}` : null
			]
				.filter(Boolean)
				.join('\n\n') || 'Nothing planned. Plan something, cowards.',
		footer: { text: `${brand} · calendar` }
	};
}
