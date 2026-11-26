// Oprema iz igre (addon → Companion → POST /companion/gear): Blizzardov API za WoW Forever like od
// ~23. 11. 2026 ne vrača več item levelov (ne skupnega ne po predmetih), igra pa jih pozna. Ko
// Blizzardovega ni (0), ga dopolnimo iz igre. Čista logika – testi v tests/game-gear.test.ts.
import type { Item } from './normalize.js';

export type GearItem = { slot: number; itemId: number; ilvl: number | null };
export type GameGear = { ilvl: number; ilvlBest: number; items: GearItem[]; at: number };

const MAX_ILVL = 1000;
const okIlvl = (n: unknown): n is number =>
	typeof n === 'number' && Number.isFinite(n) && n > 0 && n < MAX_ILVL;

/** Preveri en lik iz Companiona; `null` = neuporabno. */
export function cleanGear(c: unknown, now: number): (GameGear & { name: string }) | null {
	if (!c || typeof c !== 'object') return null;
	const o = c as Record<string, unknown>;
	const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
	if (name.length < 2 || !Array.isArray(o.items)) return null;
	const items: GearItem[] = [];
	const seen = new Set<number>();
	for (const it of o.items.slice(0, 19)) {
		if (!it || typeof it !== 'object') continue;
		const r = it as Record<string, unknown>;
		const slot = Number(r.slot);
		const itemId = Number(r.itemId);
		if (!Number.isInteger(slot) || slot < 1 || slot > 19 || seen.has(slot)) continue;
		if (!Number.isInteger(itemId) || itemId <= 0) continue;
		seen.add(slot);
		items.push({ slot, itemId, ilvl: okIlvl(r.ilvl) ? Math.round(r.ilvl) : null });
	}
	if (!items.length) return null;
	const at = typeof o.at === 'number' && o.at > 0 && o.at <= now + 3_600_000 ? o.at : now;
	return {
		name,
		ilvl: okIlvl(o.ilvl) ? o.ilvl : 0,
		ilvlBest: okIlvl(o.ilvlBest) ? o.ilvlBest : 0,
		items: items.sort((a, b) => a.slot - b.slot),
		at
	};
}

/** Blizzard kaže celo število (equipped_item_level 13 pri 13,4). */
const whole = (n: number) => Math.floor(n + 1e-9);

/**
 * Povzetek in oprema z item leveli iz igre, kjer jih Blizzard nima (0). Kar Blizzard da, ostane.
 * Vrne iste objekte, ko ni česa dopolniti.
 */
export function withGameGear<
	S extends { ilvlEquipped: number; ilvlAverage: number },
	D extends { equipment: unknown }
>(summary: S, details: D, gear: GameGear | null): { summary: S; details: D } {
	if (!gear) return { summary, details };
	let s = summary;
	if (!(summary.ilvlEquipped > 0) && gear.ilvl > 0) s = { ...s, ilvlEquipped: whole(gear.ilvl) };
	if (!(summary.ilvlAverage > 0) && (gear.ilvlBest > 0 || gear.ilvl > 0))
		s = { ...s, ilvlAverage: whole(Math.max(gear.ilvlBest, gear.ilvl)) };

	let d = details;
	const byId = new Map<number, number>();
	for (const g of gear.items) if (g.ilvl) byId.set(g.itemId, g.ilvl);
	if (Array.isArray(details.equipment) && byId.size) {
		let changed = false;
		const equipment = (details.equipment as Item[]).map((it) => {
			const lvl = byId.get(it.itemId);
			if (it.ilvl > 0 || !lvl) return it;
			changed = true;
			const tooltip = it.tooltip ?? [];
			const has = tooltip.some((l) => /^Item Level\b/.test(l.text));
			return {
				...it,
				ilvl: lvl,
				// takoj za imenom (prva vrstica), kot pri Blizzardu
				tooltip: has
					? tooltip
					: [
							...tooltip.slice(0, 1),
							{ text: `Item Level ${lvl}`, color: '#ffd100', right: null },
							...tooltip.slice(1)
						]
			};
		});
		if (changed) d = { ...d, equipment };
	}
	return { summary: s, details: d };
}
