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

/** Barva kvalitete predmeta (0 poor … 6 artifact), kot v igri. */
const QUALITY_HEX = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80'];
export const lootColor = (q: number | null | undefined) =>
	q == null ? '#e5d9b6' : (QUALITY_HEX[q] ?? '#e5d9b6');
export const QUALITY_NAME = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact'];

/** Rekordi (Big Numbers): naslov, opis in beseda med številko in tarčo. */
export const RECORD_KINDS = ['crit', 'hit', 'critHeal', 'heal', 'hitTaken'] as const;
export type RecordKindName = (typeof RECORD_KINDS)[number];
export const RECORD_LABEL: Record<RecordKindName, { title: string; quip: string; prep: string }> = {
	crit: { title: 'Biggest Crit', quip: 'The number they will not shut up about.', prep: 'into' },
	hit: { title: 'Biggest Hit', quip: 'No crit, just honest violence.', prep: 'into' },
	critHeal: { title: 'Biggest Crit Heal', quip: 'Somebody was one sneeze from dying.', prep: 'on' },
	heal: { title: 'Biggest Heal', quip: 'A band-aid the size of a tent.', prep: 'on' },
	hitTaken: { title: 'Hardest Hit Taken', quip: 'Caught it with their face.', prep: 'from' }
};

/** Company Parse barva (kot ustaljena lestvica parsov: siva … zlata). */
export function parseColor(pct: number | null | undefined): string {
	if (pct == null) return 'var(--muted-foreground)';
	if (pct >= 100) return '#e5cc80';
	if (pct >= 99) return '#e268a8';
	if (pct >= 95) return '#ff8000';
	if (pct >= 75) return '#a335ee';
	if (pct >= 50) return '#0070ff';
	if (pct >= 25) return '#1eff00';
	return '#9d9d9d';
}

/** Kratka pripomba k parsu (WoW ton, grobo). */
export function parseQuip(pct: number | null | undefined): string {
	if (pct == null) return 'Not enough victims to compare with yet.';
	if (pct >= 100) return 'Top of the company. Insufferable now.';
	if (pct >= 95) return 'Orange. Will mention it in every conversation.';
	if (pct >= 75) return 'Purple. Respectable, annoyingly so.';
	if (pct >= 50) return 'Blue. Pulling their weight, barely.';
	if (pct >= 25) return 'Green. Present, technically.';
	return 'Grey. Was the keyboard plugged in?';
}

export const ROLE_LABEL: Record<'dps' | 'heal' | 'tank', string> = {
	dps: 'DPS',
	heal: 'Healer',
	tank: 'Tank'
};
