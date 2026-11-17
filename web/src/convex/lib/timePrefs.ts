// Uporabnikove nastavitve časa (Settings → Account → Time & date): časovni pas, 12h/24h, oblika datuma.
// Čista logika (strežnik + brskalnik), testi v tests/time-prefs.test.ts.
export const DATE_FORMATS = ['DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export type TimePrefs = {
	/** IANA pas (Europe/Ljubljana); null = pas brskalnika */
	timeZone: string | null;
	hour12: boolean;
	dateFormat: DateFormat;
};
export const DEFAULT_PREFS: TimePrefs = { timeZone: null, hour12: false, dateFormat: 'DD.MM.YYYY' };

export function validTimeZone(tz: string) {
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Iz dokumenta profila (manjkajoče = privzeto). */
export function prefsOf(p: { timeZone?: string; hour12?: boolean; dateFormat?: string } | null) {
	return {
		timeZone: p?.timeZone && validTimeZone(p.timeZone) ? p.timeZone : null,
		hour12: p?.hour12 ?? DEFAULT_PREFS.hour12,
		dateFormat: (DATE_FORMATS as readonly string[]).includes(p?.dateFormat ?? '')
			? (p!.dateFormat as DateFormat)
			: DEFAULT_PREFS.dateFormat
	} satisfies TimePrefs;
}

/** Datum v izbrani obliki iz delov (leto, mesec 1–12, dan). */
export function formatYmd(y: number, m: number, d: number, f: DateFormat) {
	const dd = String(d).padStart(2, '0');
	const mm = String(m).padStart(2, '0');
	if (f === 'DD/MM/YYYY') return `${dd}/${mm}/${y}`;
	if (f === 'MM/DD/YYYY') return `${mm}/${dd}/${y}`;
	if (f === 'YYYY-MM-DD') return `${y}-${mm}-${dd}`;
	return `${dd}.${mm}.${y}`;
}

/** Ura in minuta v 24h ("20:05") ali 12h ("8:05 PM"). */
export function formatHm(h: number, min: number, hour12: boolean) {
	const mm = String(min).padStart(2, '0');
	if (!hour12) return `${String(h).padStart(2, '0')}:${mm}`;
	return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}
