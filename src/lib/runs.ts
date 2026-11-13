// Dungeon Runs: formatiranje in (črni) humor za portal.

export function fmtDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const fmtNum = (n: number | null | undefined) =>
	n == null ? '—' : Math.round(n).toLocaleString('en-US');
export const fmtRate = (n: number | null | undefined) =>
	n == null ? '—' : n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1);

const dtfmt = new Intl.DateTimeFormat('en-GB', {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit'
});
export const fmtWhen = (ms: number) => dtfmt.format(new Date(ms));

/** Kako se je run končal – z obvezno mero cinizma. */
export const END_REASON: Record<string, string> = {
	leftInstance: 'Walked out. Mostly alive.',
	newInstance: 'Dragged straight into the next dungeon. No rest for the wicked.',
	instanceReset: 'Instance reset. Nothing happened here, officer.',
	inactivity: 'Went quiet for 10 minutes. Either AFK or dead inside.',
	endOfLog: 'The log just… stopped. Like a heartbeat.',
	manual: 'Somebody hit “End run”. Rage quit, probably.',
	inProgress: 'Still going. Pray for them.'
};

export function resultBadge(r: {
	bossesKilled: number;
	bossesTotal: number | null;
	wipes: number;
	cleared: boolean;
}) {
	if (r.cleared) return { text: 'Cleared', tone: 'good' as const };
	if (r.bossesTotal)
		return {
			text: `${r.bossesKilled}/${r.bossesTotal} bosses`,
			tone: r.bossesKilled ? ('mid' as const) : ('bad' as const)
		};
	return {
		text: `${r.bossesKilled} boss${r.bossesKilled === 1 ? '' : 'es'}`,
		tone: r.bossesKilled ? ('mid' as const) : ('bad' as const)
	};
}

/** Kratek komentar pod številom smrti. */
export function deathQuip(n: number | null): string {
	if (n == null) return '';
	if (n === 0) return 'Nobody died. Suspicious.';
	if (n <= 2) return 'A light sprinkle of corpses.';
	if (n <= 5) return 'The spirit healer knows them by name.';
	if (n <= 10) return 'Graveyard frequent-flyer program.';
	return 'Mass grave. Someone call the Lich King, he’s hiring.';
}

/** Komentar ob trajanju runa. */
export function durationQuip(ms: number): string {
	const min = ms / 60_000;
	if (min < 15) return 'Speedrun or they skipped everything. Probably both.';
	if (min < 35) return 'Respectable. Nobody cried (out loud).';
	if (min < 60) return 'Long enough to age a little.';
	if (min < 120) return 'An epic saga of poor decisions.';
	return 'They moved in. The mobs started paying rent.';
}

export const ACTIVE_QUIP = (pct: number) =>
	pct >= 85
		? 'Never stopped pressing buttons'
		: pct >= 60
			? 'Mostly awake'
			: pct >= 35
				? 'Part-time hero'
				: 'Professional spectator';
