import type { FunctionReturnType } from 'convex/server';
import type { api } from '#convex/_generated/api.js';

export type RosterData = FunctionReturnType<typeof api.players.list>;
export type RosterEntry = RosterData['players'][number];
export type Summary = NonNullable<RosterEntry['summary']>;
export type Week = NonNullable<RosterEntry['week']>;
export type CharacterData = NonNullable<FunctionReturnType<typeof api.players.get>>;
export type FeedEvent = FunctionReturnType<typeof api.events.recent>[number];

export type TooltipLine = { text: string; color: string | null; right: string | null };
export type Item = {
	slot: string;
	slotType: string;
	itemId: number;
	name: string;
	quality: string;
	ilvl: number;
	icon: string | null;
	tooltip: TooltipLine[];
};
export type Profession = { name: string; primary: boolean; skill: number; max: number };
export type StatLine = { category: string; name: string; value: number };
