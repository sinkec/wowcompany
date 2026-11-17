// Sortiranje tabel po stolpcih (klik na glavo: najprej padajoče za številke, naraščajoče za imena;
// drugi klik obrne). Prazne vrednosti so vedno na dnu. Stabilno: enaki ostanejo v prvotnem vrstnem redu.
export type SortDir = 'asc' | 'desc';
export type SortValue = number | string | null | undefined | boolean;

export class TableSort<K extends string> {
	key = $state<K | null>(null);
	dir = $state<SortDir>('desc');

	constructor(key: K | null = null, dir: SortDir = 'desc') {
		this.key = key;
		this.dir = dir;
	}

	set(key: K, dir: SortDir) {
		this.key = key;
		this.dir = dir;
	}

	toggle(key: K, first: SortDir = 'desc') {
		if (this.key === key) this.dir = this.dir === 'desc' ? 'asc' : 'desc';
		else {
			this.key = key;
			this.dir = first;
		}
	}

	/** Razvrščena kopija; `get` pove vrednost stolpca za vrstico. Brez izbranega stolpca: nespremenjeno. */
	apply<T>(rows: readonly T[], get: Record<K, (row: T) => SortValue>): T[] {
		const key = this.key;
		if (!key) return [...rows];
		const f = get[key];
		const sign = this.dir === 'asc' ? 1 : -1;
		return rows
			.map((row, i) => ({ row, i, v: f(row) }))
			.sort((a, b) => {
				const an = a.v === null || a.v === undefined || a.v === '';
				const bn = b.v === null || b.v === undefined || b.v === '';
				if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
				const c =
					typeof a.v === 'string' || typeof b.v === 'string'
						? String(a.v).localeCompare(String(b.v), 'en', { sensitivity: 'base' })
						: Number(a.v) - Number(b.v);
				return c * sign || a.i - b.i;
			})
			.map((x) => x.row);
	}
}
