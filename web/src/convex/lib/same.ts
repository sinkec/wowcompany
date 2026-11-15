// Primerjava "ali se je kaj spremenilo" za poller: brez zapisa ni razveljavitve queryjev pri obiskovalcih.

/** JSON z razvrščenimi ključi; `undefined` polja izpusti (kot JSON.stringify). */
export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
	const obj = value as Record<string, unknown>;
	const parts = Object.keys(obj)
		.filter((k) => obj[k] !== undefined)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
	return `{${parts.join(',')}}`;
}

/** Ali ima shranjeni dokument `prev` v ključih `keys` iste vrednosti kot `next` (ostala polja, npr. `_id`, se ne štejejo). */
export function sameFields(prev: Record<string, unknown> | null | undefined, next: Record<string, unknown>, keys: string[]) {
	if (!prev) return false;
	const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k]]));
	return stableStringify(pick(prev)) === stableStringify(pick(next));
}
