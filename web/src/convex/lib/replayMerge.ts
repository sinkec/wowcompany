// Replay iz več snemalcev istega runa: vsak combat log ima pozicije svojega snemalca (tudi daleč od
// ostalih) in tistih v njegovem dosegu. Sledi po junaku združimo v absolutnem času; na istem koraku
// obdrži točko prednostnega posnetka (boljši run). Čista logika – testi v tests/replay-merge.test.ts.
import type { Replay } from './companionSchema.js';

/** Največ točk na junaka (Replay::MAX_POINTS v Rustu: 2 h pri 2 s). */
export const MAX_POINTS = 3600;

type Source = { startedAt: number; replay: Replay };

/**
 * Združi dva replaya istega runa. `first` ima prednost na istem koraku. Rezultat je relativen na
 * `startedAt` (začetek runa po združitvi) z večjim od obeh korakov.
 */
export function mergeReplays(first: Source, second: Source, startedAt: number): Replay {
	const bucketMs = Math.max(first.replay.bucketMs, second.replay.bucketMs);
	const tracks = new Map<string, Map<number, { x: number; y: number; map: number }>>();
	for (const src of [first, second]) {
		for (const p of src.replay.players) {
			let byStep = tracks.get(p.slug);
			if (!byStep) tracks.set(p.slug, (byStep = new Map()));
			for (let i = 0; i < p.t.length; i++) {
				const at = src.startedAt + p.t[i] * src.replay.bucketMs;
				const step = Math.round((at - startedAt) / bucketMs);
				if (step < 0 || byStep.has(step)) continue;
				byStep.set(step, { x: p.x[i], y: p.y[i], map: p.map[i] });
			}
		}
	}
	const players = [...tracks.entries()].map(([slug, byStep]) => {
		const steps = [...byStep.keys()].sort((a, b) => a - b).slice(0, MAX_POINTS);
		return {
			slug,
			t: steps,
			x: steps.map((s) => byStep.get(s)!.x),
			y: steps.map((s) => byStep.get(s)!.y),
			map: steps.map((s) => byStep.get(s)!.map)
		};
	});
	return { bucketMs, players: players.filter((p) => p.t.length) };
}
