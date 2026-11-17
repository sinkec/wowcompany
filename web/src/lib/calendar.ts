// Koledar na spletu: barve vrst dogodkov in oblike datumov (logika dogodkov je v convex/lib/calendar.ts).
export { KIND_EMOJI, KIND_LABEL, EVENT_KINDS } from '#convex/lib/calendar.js';

/** Barvni ton vrste dogodka (rob + ozadje + besedilo). Prazniki iz igre so modri, naši zlati/barvni. */
export const KIND_TONE: Record<string, string> = {
	dungeon: 'border-primary/50 bg-primary/15 text-primary',
	raid: 'border-purple-400/50 bg-purple-500/15 text-purple-300',
	pvp: 'border-red-400/50 bg-red-500/15 text-red-300',
	leveling: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300',
	social: 'border-orange-400/50 bg-orange-500/15 text-orange-300',
	other: 'border-border bg-muted/40 text-foreground',
	holiday: 'border-sky-400/40 bg-sky-500/10 text-sky-300',
	system: 'border-border bg-muted/30 text-muted-foreground'
};
export const KIND_DOT: Record<string, string> = {
	dungeon: 'bg-primary',
	raid: 'bg-purple-400',
	pvp: 'bg-red-400',
	leveling: 'bg-emerald-400',
	social: 'bg-orange-400',
	other: 'bg-foreground/60',
	holiday: 'bg-sky-400',
	system: 'bg-muted-foreground'
};

// datumi in ure po uporabnikovih nastavitvah (pas, 12h/24h, oblika datuma)
export { fmtTime, fmtDay } from '#lib/datetime.svelte.js';
import { addDays, dayStart, fmtDay, fmtTime } from '#lib/datetime.svelte.js';

const DAY = 86_400_000;
export const startOfDay = dayStart;

/** "Sat 22.11.2026 · 20:00–23:00", več dni: "Sat 22.11.2026 – Tue 25.11.2026". */
export function fmtSpan(e: { startAt: number; endAt: number }) {
	// večer čez polnoč (npr. 21:00–01:00) je še vedno en večer
	if (e.endAt - e.startAt >= 20 * 3_600_000) return `${fmtDay(e.startAt)} – ${fmtDay(e.endAt - 1)}`;
	if (e.endAt === e.startAt) return `${fmtDay(e.startAt)} · ${fmtTime(e.startAt)}`;
	return `${fmtDay(e.startAt)} · ${fmtTime(e.startAt)}–${fmtTime(e.endAt)}`;
}

/** "in 3 days", "tomorrow", "now", "today 20:00". */
export function whenLabel(e: { startAt: number; endAt: number }, now = Date.now()) {
	if (e.startAt <= now && e.endAt >= now) return 'happening now';
	const days = Math.round((startOfDay(e.startAt) - startOfDay(now)) / DAY);
	if (days === 0) return `today ${fmtTime(e.startAt)}`;
	if (days === 1) return `tomorrow ${fmtTime(e.startAt)}`;
	if (days < 0) return 'over';
	return `in ${days} days`;
}

/** Začetek ure (stabilni argument -> Convex lahko predpomni poizvedbo). */
export const hourNow = () => Math.floor(Date.now() / 3_600_000) * 3_600_000;

/** Ali dogodek pade na dan, ki se začne ob `day` (konec točno ob polnoči ne šteje v naslednji dan). */
export const onDayOf = (e: { startAt: number; endAt: number }, day: number) =>
	e.startAt < addDays(day, 1) && (e.endAt > day || e.startAt >= day);
