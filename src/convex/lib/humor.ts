// Skupna (šaljiva) besedila za spletno stran in Discord. Angleščina, WoW ton, malo črnega humorja.

export type SessionLike = {
	level?: { from: number; to: number } | null;
	kills?: number | null;
	deaths?: number | null;
	quests?: number | null;
	newItems?: { name: string; quality: string }[] | null;
	ilvl?: { from: number; to: number } | null;
	ilvlAverage?: { from: number; to: number } | null;
	achievementPoints?: number | null;
	counters?: Record<string, number> | null;
	professions?: unknown[] | null;
};

const pick = <T>(arr: T[], seed: number) => arr[Math.abs(seed) % arr.length];

/** En stavek za povzetek seje (brez imena na začetku). `seed` izbere varianto. */
export function sessionHeadline(e: SessionLike, seed = 0): string {
	const lv = e.level && e.level.to > e.level.from ? e.level.to - e.level.from : 0;
	const d = e.deaths ?? null;
	const k = e.kills ?? 0;
	if (lv >= 3)
		return pick(
			[
				`binged so hard they gained ${lv} levels. Touch grass, maybe?`,
				`gained ${lv} levels in one sitting. Their chair is now part of their body.`,
				`skipped sleep, food and hygiene for ${lv} levels. Worth it.`
			],
			seed
		);
	if (lv > 0)
		return pick(
			[`dinged level ${e.level?.to}. Somebody clap.`, `hit level ${e.level?.to}. Mom would be proud. Probably.`, `is now level ${e.level?.to}. Still bad, just higher level.`],
			seed
		);
	if (d != null && d >= 5)
		return pick(
			[
				`died ${d} times in one session. The spirit healer wants a restraining order.`,
				`died ${d} times. At this point the graveyard charges rent.`,
				`perished ${d} times. Natural selection keeps trying.`
			],
			seed
		);
	if (d === 0 && k > 50) return `slaughtered ${k.toLocaleString('en-US')} things and didn't die once. Suspicious.`;
	if (d != null && d > 0) return `logged off after dying ${d === 1 ? 'once' : `${d} times`}. Classic.`;
	if ((e.newItems?.length ?? 0) > 0) return 'went shopping with a sword. Came back with loot.';
	if ((e.quests ?? 0) > 0) return `ran ${e.quests} errands for strangers. Unpaid, as usual.`;
	return 'logged out. Riveting stuff.';
}

/** Ali je seja vredna objave (ne spamaj kanala z "prijavil se je in nič naredil"). */
export function isNewsworthy(e: SessionLike): boolean {
	const changed = (r?: { from: number; to: number } | null) => !!r && r.to !== r.from;
	return !!(
		(e.level && e.level.to > e.level.from) ||
		changed(e.ilvl) ||
		changed(e.ilvlAverage) ||
		(e.kills ?? 0) > 0 ||
		(e.deaths ?? 0) > 0 ||
		(e.quests ?? 0) > 0 ||
		(e.achievementPoints ?? 0) > 0 ||
		(e.newItems?.length ?? 0) > 0 ||
		(e.professions?.length ?? 0) > 0 ||
		Object.values(e.counters ?? {}).some((v) => v > 0)
	);
}

/** Fun counters coming from Blizzard statistics, with labels for the leaderboard of shame. */
export const COUNTER_LABELS: Record<string, string> = {
	kills: 'Things murdered',
	killing_blows: 'Killing blows',
	deaths: 'Times eaten dirt',
	falling_deaths: 'Lost fights with gravity',
	quests: 'Errands run for strangers',
	dungeons: 'Dungeons entered',
	food: 'Food stuffed down the gob',
	drinks: 'Drinks chugged',
	hearthed: 'Ran home to mommy (hearth)',
	flight_paths: 'Flights taken',
	fish: 'Fish caught',
	bandages: 'Bandages slapped on',
	potions: 'Potions chugged',
	need_rolls: 'Greedy NEED rolls',
	greed_rolls: 'Polite greed rolls',
	camped: 'Times camped'
};
