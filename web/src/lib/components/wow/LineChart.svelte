<script lang="ts">
	// Ena serija na graf (naslov jo poimenuje, brez legende): stopničasta črta s polnilom v prelivu,
	// crosshair + tooltip (Chart.js, barve teme).
	import type { ChartConfiguration } from 'chart.js';
	import { fmtDate, fmtDateTime } from '#lib/datetime.svelte.js';
	import ChartCanvas from './ChartCanvas.svelte';
	import { alpha, baseOptions, chartTheme, crosshair, resolveColor } from '#lib/chart.js';

	let {
		title,
		points,
		color,
		format = (n: number) => n.toLocaleString('en-US'),
		empty = 'Not enough history yet. Go play, then log out.'
	}: {
		title: string;
		points: { t: number; v: number }[];
		color?: string;
		format?: (n: number) => string;
		empty?: string;
	} = $props();


	const config = $derived.by((): ChartConfiguration<'line'> => {
		const t = chartTheme();
		const c = color ? resolveColor(color) : t.primary;
		const base = baseOptions(t);
		// zadnja vrednost velja do zdaj
		const pts = points.length ? [...points, { t: Date.now(), v: points[points.length - 1].v }] : [];
		return {
			type: 'line',
			data: {
				datasets: [
					{
						data: pts.map((p) => ({ x: p.t, y: p.v })),
						borderColor: c,
						borderWidth: 2,
						stepped: 'after',
						pointRadius: 0,
						pointHoverRadius: 5,
						pointHoverBorderWidth: 2,
						pointHoverBorderColor: t.card,
						pointHoverBackgroundColor: c,
						fill: true,
						backgroundColor: (ctx) => {
							const area = ctx.chart.chartArea;
							if (!area) return alpha(c, 0.15);
							const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
							g.addColorStop(0, alpha(c, 0.32));
							g.addColorStop(1, alpha(c, 0));
							return g;
						}
					}
				]
			},
			options: {
				...base,
				plugins: {
					...base.plugins,
					tooltip: {
						...base.plugins.tooltip,
						displayColors: false,
						callbacks: {
							title: (items) => fmtDateTime(items[0].parsed.x ?? 0),
							label: (item) => format(item.parsed.y ?? 0)
						}
					}
				},
				scales: {
					x: {
						...base.scales.x,
						type: 'linear',
						min: pts[0]?.t,
						max: pts.at(-1)?.t,
						ticks: {
							...base.scales.x.ticks,
							maxTicksLimit: 6,
							callback: (v) => fmtDate(Number(v))
						}
					},
					y: {
						...base.scales.y,
						grace: '8%',
						ticks: { ...base.scales.y.ticks, callback: (v) => format(Math.round(Number(v))) }
					}
				}
			},
			plugins: [crosshair]
		};
	});
</script>

<figure class="wow-frame rounded-lg p-4">
	<figcaption class="mb-2 flex items-baseline justify-between">
		<span class="text-sm font-semibold text-primary">{title}</span>
		{#if points.length}<span class="text-sm tabular-nums"
				>{format(points[points.length - 1].v)}</span
			>{/if}
	</figcaption>
	{#if points.length < 2}
		<p class="py-8 text-center text-sm text-muted-foreground italic">{empty}</p>
	{:else}
		<ChartCanvas config={config as ChartConfiguration} label={title} class="h-44" />
	{/if}
</figure>
