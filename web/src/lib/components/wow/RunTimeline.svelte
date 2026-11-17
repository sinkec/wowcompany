<script lang="ts">
	import { Toggle } from '#lib/components/ui/toggle/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	// Časovnica runa (Chart.js): na sekundo po igralcih (barva razreda), boss boji osenčeni (wipe rdeče),
	// skupna os. Replay: kazalec predvajanja, prihodnost zatemnjena, vsote do tega trenutka; klik ali
	// vlečenje po grafu premakne predvajanje.
	import type { ChartConfiguration, Plugin } from 'chart.js';
	import ChartCanvas from './ChartCanvas.svelte';
	import { alpha, baseOptions, chartTheme, type Chart } from '#lib/chart.js';
	import { classColor } from '#lib/wow.js';
	import { fmtDuration, fmtNum } from '#lib/runs.js';

	type Series = { slug: string; damage: number[]; healing: number[]; taken: number[] };
	type Segment = { kind: string; name: string; startMs: number; endMs: number; result: string };
	let {
		timeline,
		segments,
		names,
		classes,
		cursorMs = null,
		onseek
	}: {
		timeline: { bucketMs: number; players: Series[] };
		segments: Segment[];
		names: Record<string, string>;
		classes: Record<string, number | null>;
		/** replay: trenutek predvajanja (črta, prihodnost zatemnjena, vsote do tega trenutka) */
		cursorMs?: number | null;
		/** replay: klik/vlečenje po grafu premakne predvajanje */
		onseek?: (ms: number) => void;
	} = $props();

	const LABEL = { damage: 'Damage', healing: 'Healing', taken: 'Damage taken' } as const;
	type Metric = keyof typeof LABEL;
	let metric = $state<Metric>('damage');
	let hidden = $state<Record<string, boolean>>({});

	const bucket = $derived(timeline.bucketMs);
	const n = $derived(Math.max(1, ...timeline.players.map((p) => p.damage.length)));
	const total = $derived(n * bucket);
	const shown = $derived(timeline.players.filter((p) => p[metric].some((v) => v > 0)));
	const bosses = $derived(segments.filter((s) => s.kind === 'boss'));
	const cursorBucket = $derived(cursorMs == null ? null : Math.floor(cursorMs / bucket));
	const sums = $derived(
		Object.fromEntries(
			shown.map((p) => [
				p.slug,
				p[metric]
					.slice(0, cursorBucket === null ? undefined : cursorBucket + 1)
					.reduce((a, b) => a + b, 0)
			])
		)
	);
	// barva = razred; junak brez znanega razreda dobi barvo iz stalne palete (po vrstnem redu v partyju)
	const FALLBACK = ['#e8b64c', '#e0705a', '#b48ae8', '#e68fc0', '#9ad16a', '#5cb8e6', '#d9d0bd'];
	const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	const near = (a: string, b: string) =>
		rgb(a).reduce((t, v, i) => t + (v - rgb(b)[i]) ** 2, 0) < 90 ** 2;
	const colorOf = $derived.by(() => {
		const out: Record<string, string> = {};
		const used = timeline.players
			.filter((p) => classes[p.slug])
			.map((p) => classColor(classes[p.slug] ?? undefined));
		const free = FALLBACK.filter((f) => !used.some((u) => u.startsWith('#') && near(f, u)));
		let k = 0;
		for (const p of timeline.players)
			out[p.slug] = classes[p.slug]
				? classColor(classes[p.slug] ?? undefined)
				: (free[k++] ?? FALLBACK[k % FALLBACK.length]);
		return out;
	});
	// 10-sekundni koraki so nazobčani: prikaz = drseče povprečje ~30 s (vsote ostanejo točne)
	const win = $derived(Math.max(1, Math.round(30_000 / bucket)));
	const smooth = (xs: number[]) =>
		xs.map((_, i) => {
			const a = Math.max(0, i - Math.floor(win / 2));
			const b = Math.min(xs.length, a + win);
			let t = 0;
			for (let j = a; j < b; j++) t += xs[j];
			return t / (b - a);
		});
	const ranked = $derived([...shown].sort((a, b) => (sums[b.slug] ?? 0) - (sums[a.slug] ?? 0)));

	// kazalec bere plugin iz tega objekta (brez novega configa ob vsakem okvirju predvajanja)
	const live = { cursor: null as number | null };
	let chart: Chart | null = null;
	$effect(() => {
		live.cursor = cursorMs;
		chart?.draw();
	});

	const segmentsPlugin: Plugin = {
		id: 'bossSegments',
		beforeDatasetsDraw(c) {
			const { ctx, chartArea: a, scales } = c;
			const x = scales.x;
			ctx.save();
			for (const b of bosses) {
				const x0 = x.getPixelForValue(b.startMs);
				const x1 = Math.max(x0 + 2, x.getPixelForValue(b.endMs));
				ctx.fillStyle =
					b.result === 'wipe' ? 'rgba(248, 113, 113, 0.16)' : alpha(chartTheme().primary, 0.14);
				ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
			}
			// imena bossov zgoraj, brez prekrivanja
			ctx.font = '10px Inter Variable, Inter, sans-serif';
			ctx.fillStyle = chartTheme().muted;
			ctx.textBaseline = 'top';
			let lastEnd = -Infinity;
			let lastName = '';
			for (const b of bosses) {
				const px = x.getPixelForValue(b.startMs) + 3;
				const w = ctx.measureText(b.name).width;
				if (px < lastEnd + 6 || b.name === lastName) continue;
				ctx.fillText(b.name, px, a.top + 2);
				lastEnd = px + w;
				lastName = b.name;
			}
			ctx.restore();
		}
	};
	const cursorPlugin: Plugin = {
		id: 'replayCursor',
		afterDatasetsDraw(c) {
			if (live.cursor == null) return;
			const { ctx, chartArea: a, scales } = c;
			const px = Math.min(a.right, Math.max(a.left, scales.x.getPixelForValue(live.cursor)));
			ctx.save();
			ctx.fillStyle = alpha(chartTheme().card, 0.62);
			ctx.fillRect(px, a.top, a.right - px, a.bottom - a.top);
			ctx.strokeStyle = 'rgba(255,255,255,0.95)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(px, a.top);
			ctx.lineTo(px, a.bottom);
			ctx.stroke();
			ctx.fillStyle = 'white';
			ctx.beginPath();
			ctx.arc(px, a.top, 4, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}
	};

	const config = $derived.by((): ChartConfiguration<'line'> => {
		const t = chartTheme();
		const base = baseOptions(t);
		const perSec = 1000 / bucket;
		return {
			type: 'line',
			data: {
				datasets: shown.map((p) => {
					const c = colorOf[p.slug];
					return {
						label: names[p.slug] ?? p.slug,
						data: smooth(p[metric]).map((v, i) => ({ x: (i + 0.5) * bucket, y: v * perSec })),
						hidden: !!hidden[p.slug],
						borderColor: c,
						backgroundColor: c,
						borderWidth: 2,
						tension: 0.35,
						cubicInterpolationMode: 'monotone' as const,
						pointRadius: 0,
						pointHoverRadius: 4,
						pointHoverBorderWidth: 2,
						pointHoverBorderColor: t.card
					};
				})
			},
			options: {
				...base,
				// predvajanje premika samo kazalec: brez animacije ob vsaki spremembi
				animation: onseek ? false : base.animation,
				plugins: {
					...base.plugins,
					tooltip: {
						...base.plugins.tooltip,
						itemSort: (a, b) => (b.parsed.y ?? 0) - (a.parsed.y ?? 0),
						callbacks: {
							title: (items) => {
								const i = Math.floor((items[0]?.parsed.x ?? 0) / bucket);
								return `${fmtDuration(i * bucket)}–${fmtDuration((i + 1) * bucket)}`;
							},
							label: (item) => ` ${item.dataset.label}: ${fmtNum(item.parsed.y ?? 0)}/s`
						}
					}
				},
				scales: {
					x: {
						...base.scales.x,
						type: 'linear',
						min: 0,
						max: total,
						ticks: {
							...base.scales.x.ticks,
							maxTicksLimit: 8,
							callback: (v) => fmtDuration(Number(v))
						}
					},
					y: {
						...base.scales.y,
						beginAtZero: true,
						ticks: { ...base.scales.y.ticks, callback: (v) => fmtNum(Number(v)) }
					}
				}
			},
			plugins: [segmentsPlugin, cursorPlugin]
		};
	});

	// klik/vlečenje -> čas predvajanja
	let dragging = false;
	function seekAt(e: PointerEvent) {
		if (!onseek || !chart) return;
		const a = chart.chartArea;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const px = Math.min(a.right, Math.max(a.left, e.clientX - r.left));
		onseek(Math.max(0, Math.min(total, chart.scales.x.getValueForPixel(px) ?? 0)));
	}
</script>

<div class="space-y-3">
	<div class="flex flex-wrap items-center gap-2 text-sm">
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			aria-label="Metric"
			bind:value={() => metric, (v) => v && (metric = v as Metric)}
		>
			{#each Object.entries(LABEL) as [k, label] (k)}
				<ToggleGroup.Item value={k}>{label}</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
		<span class="ml-auto text-xs text-muted-foreground">
			per second{win > 1 ? `, ${(win * bucket) / 1000} s average` : ''} · shaded = boss fights{#if bosses.some((b) => b.result === 'wipe')},
				red = wipes{/if}
		</span>
	</div>

	{#if !shown.length}
		<p class="text-sm text-muted-foreground italic">
			Nobody did any {metric === 'taken' ? 'tanking' : metric}. Impressive, in a way.
		</p>
	{:else}
		<ChartCanvas
			{config}
			label="{LABEL[metric]} per second over the run"
			class="h-64 {onseek ? 'cursor-ew-resize touch-none' : ''}"
			onready={(c) => (chart = c)}
			onpointerdown={(e) => {
				if (!onseek) return;
				dragging = true;
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				seekAt(e);
			}}
			onpointermove={(e) => dragging && seekAt(e)}
			onpointerup={() => (dragging = false)}
			onpointerleave={() => (dragging = false)}
		/>
		<!-- legenda = vsote (do kazalca v replayu); klik skrije/pokaže junaka -->
		<ul class="flex flex-wrap gap-2" aria-label="Totals">
			{#each ranked as p (p.slug)}
				{@const c = colorOf[p.slug]}
				<li>
					<Toggle
						variant="outline"
						size="sm"
						class="gap-2 text-xs aria-pressed:bg-transparent data-[state=off]:opacity-40"
						aria-label="{hidden[p.slug] ? 'Show' : 'Hide'} {names[p.slug] ?? p.slug}"
						bind:pressed={() => !hidden[p.slug], (on) => (hidden = { ...hidden, [p.slug]: !on })}
					>
						<span class="size-2.5 rounded-full" style="background: {c}"></span>
						<span class="font-semibold">{names[p.slug] ?? p.slug}</span>
						<span class="text-muted-foreground tabular-nums">{fmtNum(sums[p.slug] ?? 0)}</span>
					</Toggle>
				</li>
			{/each}
		</ul>
	{/if}
</div>
