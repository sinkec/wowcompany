// Datumi in ure po uporabnikovih nastavitvah (Settings → Account → Time & date): časovni pas, 12h/24h,
// oblika datuma. Layout ob prijavi nastavi `timePrefs` iz profila; obiskovalci dobijo privzeto
// (pas brskalnika, 24h, DD.MM.YYYY). Vse oblikovanje datumov na strani gre skozi te funkcije.
import { DEFAULT_PREFS, formatHm, formatYmd, type TimePrefs } from '#convex/lib/timePrefs.js';

export const timePrefs = $state<TimePrefs>({ ...DEFAULT_PREFS });

export function setTimePrefs(p: TimePrefs | null | undefined) {
	const next = p ?? DEFAULT_PREFS;
	timePrefs.timeZone = next.timeZone;
	timePrefs.hour12 = next.hour12;
	timePrefs.dateFormat = next.dateFormat;
}

export const browserTimeZone = () =>
	typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

/** Dejanski pas: izbran v nastavitvah ali pas brskalnika. */
export const tz = () => timePrefs.timeZone ?? browserTimeZone();

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(zone: string) {
	let f = fmtCache.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-GB', {
			timeZone: zone,
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			weekday: 'short',
			hourCycle: 'h23'
		});
		fmtCache.set(zone, f);
	}
	return f;
}

export type Parts = { y: number; m: number; d: number; h: number; min: number; weekday: string };

/** Leto, mesec (1–12), dan, ura, minuta in dan v tednu v izbranem pasu. */
export function partsOf(ms: number, zone = tz()): Parts {
	const p = Object.fromEntries(
		partsFmt(zone)
			.formatToParts(ms)
			.map((x) => [x.type, x.value])
	);
	return {
		y: Number(p.year),
		m: Number(p.month),
		d: Number(p.day),
		h: Number(p.hour) % 24,
		min: Number(p.minute),
		weekday: p.weekday
	};
}

/** Odmik pasa (ms) v danem trenutku. */
function offsetAt(ms: number, zone: string) {
	const p = partsOf(ms, zone);
	return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60_000) * 60_000;
}

/** Trenutek (ms) za lokalni datum in uro v izbranem pasu. */
export function fromParts(y: number, m: number, d: number, h = 0, min = 0, zone = tz()) {
	const guess = Date.UTC(y, m - 1, d, h, min);
	const first = guess - offsetAt(guess, zone);
	// prehod poletni/zimski čas: drugi poskus z odmikom v ciljnem trenutku
	return guess - offsetAt(first, zone);
}

/** Začetek dneva (00:00) v izbranem pasu. */
export function dayStart(ms: number) {
	const p = partsOf(ms);
	return fromParts(p.y, p.m, p.d);
}

/** Isti dan ± n dni (00:00 v pasu). */
export function addDays(dayMs: number, n: number) {
	const p = partsOf(dayMs + 12 * 3_600_000);
	return fromParts(p.y, p.m, p.d + n);
}

export const fmtDate = (ms: number) => {
	const p = partsOf(ms);
	return formatYmd(p.y, p.m, p.d, timePrefs.dateFormat);
};
export const fmtTime = (ms: number) => {
	const p = partsOf(ms);
	return formatHm(p.h, p.min, timePrefs.hour12);
};
export const fmtDateTime = (ms: number) => `${fmtDate(ms)} ${fmtTime(ms)}`;
/** "Sat 22.11.2026" (dan v tednu + datum). */
export const fmtDay = (ms: number) => `${partsOf(ms).weekday} ${fmtDate(ms)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthShort = (ms: number) => MONTHS[partsOf(ms).m - 1];
export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** Začetek runa ipd.: "Sun 15.11.2026, 16:28". */
export const fmtWhen = (ms: number) => `${fmtDay(ms)}, ${fmtTime(ms)}`;
