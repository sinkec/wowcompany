<script lang="ts">
	// Časovnica runa: en graf na igralca (stolpci po 10 s), boss segmenti osenčeni, skupna os.
	import { classColor } from '#lib/wow.js';
	import { fmtDuration, fmtNum } from '#lib/runs.js';

	type Series = { slug: string; damage: number[]; healing: number[]; taken: number[] };
	let {
		timeline,
		segments,
		names,
		classes
	}: {
		timeline: { bucketMs: number; players: Series[] };
		segments: { kind: string; name: string; startMs: number; endMs: number; result: string }[];
		names: Record<string, string>;
		classes: Record<string, number | null>;
	} = $props();

	let metric = $state<'damage' | 'healing' | 'taken'>('damage');
	let hover = $state<number | null>(null);

	const W = 600;
	const H = 54;
	const n = $derived(Math.max(1, ...timeline.players.map((p) => p.damage.length)));
	const total = $derived(n * timeline.bucketMs);
	const max = $derived(Math.max(1, ...timeline.players.flatMap((p) => p[metric])));
	const bw = $derived(W / n);
	const shown = $derived(timeline.players.filter((p) => p[metric].some((v) => v > 0)));
	const bosses = $derived(segments.filter((s) => s.kind === 'boss'));
	// napisi pod grafom: brez prekrivanja (wipe + kill istega bossa sta blizu)
	const labels = $derived.by(() => {
		const out: { name: string; at: number }[] = [];
		for (const b of bosses) {
			const at = b.startMs / total;
			const prev = out.at(-1);
			if (prev && (prev.name === b.name || at - prev.at < 0.12)) continue;
			out.push({ name: b.name, at });
		}
		return out;
	});
	const LABEL = { damage: 'Damage done', healing: 'Healing done', taken: 'Damage taken' } as const;

	function onMove(e: PointerEvent) {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		hover = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
	}
</script>

<div class="space-y-3">
	<div class="flex flex-wrap items-center gap-2 text-sm">
		{#each Object.entries(LABEL) as [k, label] (k)}
			<button
				class="rounded-md border px-2.5 py-1 {metric === k
					? 'border-primary bg-primary/15 text-primary'
					: 'border-border text-muted-foreground hover:text-foreground'}"
				onclick={() => (metric = k as typeof metric)}>{label}</button
			>
		{/each}
		<span class="ml-auto text-xs text-muted-foreground">
			{#if hover !== null}
				{fmtDuration(hover * timeline.bucketMs)}–{fmtDuration((hover + 1) * timeline.bucketMs)}
			{:else}
				per {timeline.bucketMs / 1000} s · shaded = boss fights
			{/if}
		</span>
	</div>

	{#if !shown.length}
		<p class="text-sm text-muted-foreground italic">
			Nobody did any {metric === 'taken' ? 'tanking' : metric}. Impressive, in a way.
		</p>
	{/if}
	{#each shown as p (p.slug)}
		{@const vals = p[metric]}
		<div class="grid grid-cols-[9rem_1fr_5rem] items-center gap-3">
			<div
				class="truncate text-sm font-semibold"
				style="color: {classColor(classes[p.slug] ?? undefined)}"
			>
				{names[p.slug] ?? p.slug}
			</div>
			<svg
				viewBox="0 0 {W} {H}"
				preserveAspectRatio="none"
				class="h-12 w-full rounded bg-background/40"
				role="img"
				aria-label="{LABEL[metric]} over time for {names[p.slug] ?? p.slug}"
				onpointermove={onMove}
				onpointerleave={() => (hover = null)}
			>
				{#each bosses as b, i (i)}
					<rect
						x={(b.startMs / total) * W}
						width={Math.max(1, ((b.endMs - b.startMs) / total) * W)}
						y="0"
						height={H}
						fill={b.result === 'wipe' ? 'oklch(0.6 0.2 27 / 18%)' : 'oklch(0.8 0.13 85 / 12%)'}
					/>
				{/each}
				{#each vals as v, i (i)}
					{#if v > 0}
						<rect
							x={i * bw + 0.5}
							width={Math.max(0.5, bw - 1)}
							y={H - (v / max) * (H - 2)}
							height={(v / max) * (H - 2)}
							fill={metric === 'taken'
								? 'oklch(0.6 0.2 27)'
								: metric === 'healing'
									? 'oklch(0.72 0.17 145)'
									: 'var(--color-primary)'}
							opacity={hover === null || hover === i ? 0.95 : 0.45}
						/>
					{/if}
				{/each}
			</svg>
			<div class="text-right text-xs text-muted-foreground tabular-nums">
				{hover !== null ? fmtNum(vals[hover] ?? 0) : fmtNum(vals.reduce((a, b) => a + b, 0))}
			</div>
		</div>
	{/each}
	{#if bosses.length}
		<div class="grid grid-cols-[9rem_1fr_5rem] gap-3 text-[10px] text-muted-foreground">
			<span></span>
			<div class="relative h-4">
				{#each labels as l, i (i)}
					<span class="absolute truncate" style="left: {l.at * 100}%; max-width: 20%">{l.name}</span
					>
				{/each}
			</div>
			<span></span>
		</div>
	{/if}
</div>
