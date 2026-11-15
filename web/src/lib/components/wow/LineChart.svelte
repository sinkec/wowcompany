<script lang="ts">
	// One series per chart (title names it, no legend), step line, crosshair + tooltip.
	let {
		title,
		points,
		color = 'var(--color-primary)',
		format = (n: number) => n.toLocaleString('en-US'),
		empty = 'Not enough history yet. Go play, then log out.'
	}: {
		title: string;
		points: { t: number; v: number }[];
		color?: string;
		format?: (n: number) => string;
		empty?: string;
	} = $props();

	const W = 600,
		H = 180,
		PL = 44,
		PR = 12,
		PT = 12,
		PB = 26;
	let hover = $state<number | null>(null);
	let svg = $state<SVGSVGElement>();

	const pts = $derived(points.length ? [...points, { t: Date.now(), v: points[points.length - 1].v }] : []);
	const t0 = $derived(pts[0]?.t ?? 0);
	const t1 = $derived(Math.max(pts[pts.length - 1]?.t ?? 1, t0 + 3600_000));
	const vMin = $derived(Math.min(...pts.map((p) => p.v)));
	const vMax = $derived(Math.max(...pts.map((p) => p.v)));
	const lo = $derived(vMin === vMax ? vMin - 1 : vMin);
	const hi = $derived(vMin === vMax ? vMax + 1 : vMax);
	const x = (t: number) => PL + ((t - t0) / (t1 - t0)) * (W - PL - PR);
	const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
	const path = $derived(pts.map((p, i) => (i === 0 ? `M${x(p.t)},${y(p.v)}` : `H${x(p.t)}V${y(p.v)}`)).join(''));
	const ticks = $derived([lo, (lo + hi) / 2, hi]);
	const dfmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
	const dtfmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

	function onMove(e: PointerEvent) {
		if (!svg) return;
		const r = svg.getBoundingClientRect();
		const t = t0 + ((((e.clientX - r.left) / r.width) * W - PL) / (W - PL - PR)) * (t1 - t0);
		let idx = 0;
		for (let i = 0; i < points.length; i++) if (points[i].t <= t) idx = i;
		hover = idx;
	}
	const hp = $derived(hover != null ? points[hover] : null);
</script>

<figure class="wow-frame rounded-lg p-4">
	<figcaption class="mb-2 flex items-baseline justify-between">
		<span class="text-sm font-semibold text-primary">{title}</span>
		{#if points.length}<span class="text-sm tabular-nums">{format(points[points.length - 1].v)}</span>{/if}
	</figcaption>
	{#if points.length < 2}
		<p class="py-8 text-center text-sm text-muted-foreground italic">{empty}</p>
	{:else}
		<div class="relative">
			<svg
				bind:this={svg}
				viewBox="0 0 {W} {H}"
				class="w-full touch-none select-none"
				role="img"
				aria-label={title}
				onpointermove={onMove}
				onpointerleave={() => (hover = null)}
			>
				{#each ticks as tv, i (i)}
					<line x1={PL} x2={W - PR} y1={y(tv)} y2={y(tv)} stroke="var(--color-border)" stroke-width="1" />
					<text x={PL - 6} y={y(tv)} dy="0.32em" text-anchor="end" class="fill-muted-foreground text-[11px]">
						{format(Math.round(tv))}
					</text>
				{/each}
				<text x={PL} y={H - 6} class="fill-muted-foreground text-[11px]">{dfmt.format(t0)}</text>
				<text x={W - PR} y={H - 6} text-anchor="end" class="fill-muted-foreground text-[11px]">now</text>
				<path d={path} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" />
				{#if hp}
					<line x1={x(hp.t)} x2={x(hp.t)} y1={PT} y2={H - PB} stroke="var(--color-muted-foreground)" stroke-dasharray="3 3" />
					<circle cx={x(hp.t)} cy={y(hp.v)} r="4.5" fill={color} stroke="var(--color-card)" stroke-width="2" />
				{/if}
			</svg>
			{#if hp}
				<div
					class="pointer-events-none absolute top-0 rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-lg"
					style="left: clamp(0px, calc({(x(hp.t) / W) * 100}% - 50px), calc(100% - 110px))"
				>
					<div class="text-muted-foreground">{dtfmt.format(hp.t)}</div>
					<div class="font-semibold tabular-nums">{format(hp.v)}</div>
				</div>
			{/if}
		</div>
	{/if}
</figure>
