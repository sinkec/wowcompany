// Imena, ID-ji in kakovost predmetov. Forever static namespace za `item/{id}` vrača 404 in njegov
// iskalnik ne pozna večine predmetov; retail (static-eu) in classic pa iste klasične predmete imata
// (preverjeno 15. 11. 2026: 6449 Glowing Lizardscale Cloak RARE). Predmeti samo za Forever ostanejo
// addonu. Čiste funkcije – testi v tests/items.test.ts.

export const QUALITY_BY_TYPE: Record<string, number> = {
	POOR: 0,
	COMMON: 1,
	UNCOMMON: 2,
	RARE: 3,
	EPIC: 4,
	LEGENDARY: 5,
	ARTIFACT: 6,
	HEIRLOOM: 7
};

/**
 * "Gleaming Claymore of the Wolf" / "Barbed Club of Shadow Protection" → osnova (naključne pripone imajo
 * kakovost osnove). Osnova mora imeti vsaj dve besedi: "Cloak of Hermitic Bliss" je pravo ime, ne "Cloak" + pripona.
 */
export function baseName(name: string): string | null {
	const m = name.match(/^(.+?) of (?:the )?[A-Z][a-z]+(?: [A-Z][a-z]+)?$/);
	return m && m[1].includes(' ') ? m[1] : null;
}

/** Iz zadetkov iskanja: natančno ujemanje imena (en_GB ali en_US). */
export function exactHit(
	results: {
		data: { id: number; name: Record<string, string> | string; quality?: { type?: string } };
	}[],
	name: string
): { itemId: number; quality: number | null } | null {
	for (const r of results) {
		const n =
			typeof r.data.name === 'string' ? r.data.name : (r.data.name.en_GB ?? r.data.name.en_US);
		if (n === name)
			return { itemId: r.data.id, quality: QUALITY_BY_TYPE[r.data.quality?.type ?? ''] ?? null };
	}
	return null;
}
