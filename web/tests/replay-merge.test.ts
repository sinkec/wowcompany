import { expect, test } from 'bun:test';
import { mergeReplays } from '../src/convex/lib/replayMerge.ts';

const track = (slug: string, t: number[], x = 0) => ({
	slug,
	t,
	x: t.map((_, i) => x + i),
	y: t.map(() => 5),
	map: t.map(() => 1)
});

test('fills one recorder’s gaps with the other’s points, in absolute time', () => {
	// A starts at 0, B's run starts 4 s later (its t=0 is A's t=2 at 2 s steps)
	const a = { startedAt: 0, replay: { bucketMs: 2000, players: [track('lil', [0, 1, 5])] } };
	const b = { startedAt: 4000, replay: { bucketMs: 2000, players: [track('lil', [0, 1, 2], 100), track('sinek', [3])] } };
	const m = mergeReplays(a, b, 0);
	const lil = m.players.find((p) => p.slug === 'lil')!;
	expect(lil.t).toEqual([0, 1, 2, 3, 4, 5]);
	// step 5: A's own point wins over nothing; steps 2–4 come from B
	expect(lil.x).toEqual([0, 1, 100, 101, 102, 2]);
	expect(m.players.find((p) => p.slug === 'sinek')!.t).toEqual([5]);
});

test('the first source wins on the same step', () => {
	const a = { startedAt: 0, replay: { bucketMs: 2000, players: [track('lil', [0], 7)] } };
	const b = { startedAt: 0, replay: { bucketMs: 2000, players: [track('lil', [0], 9)] } };
	expect(mergeReplays(a, b, 0).players[0].x).toEqual([7]);
	expect(mergeReplays(b, a, 0).players[0].x).toEqual([9]);
});

test('coarser steps win and points before the start are dropped', () => {
	const a = { startedAt: 0, replay: { bucketMs: 2000, players: [track('lil', [0, 1, 2, 3])] } };
	const b = { startedAt: -10_000, replay: { bucketMs: 4000, players: [track('lil', [0, 3])] } };
	const m = mergeReplays(a, b, 0);
	expect(m.bucketMs).toBe(4000);
	expect(m.players[0].t).toEqual([0, 1, 2]);
});
