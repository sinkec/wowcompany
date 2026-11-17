<script lang="ts">
	// Ovoj za Chart.js: graf nastane ob prvem prikazu in se posodobi, ko se spremeni `config`
	// (podatki ali nastavitve). `onready` dobi primerek (npr. za kazalec replaya brez prerisovanja).
	import { untrack } from 'svelte';
	import type { ChartConfiguration } from 'chart.js';
	import { Chart } from '#lib/chart.js';

	let {
		config,
		label,
		class: cls = 'h-56',
		onready,
		...rest
	}: {
		config: ChartConfiguration;
		label: string;
		class?: string;
		onready?: (chart: Chart) => void;
		onpointerdown?: (e: PointerEvent) => void;
		onpointermove?: (e: PointerEvent) => void;
		onpointerup?: (e: PointerEvent) => void;
		onpointerleave?: (e: PointerEvent) => void;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let chart: Chart | null = null;

	$effect(() => {
		if (!canvas) return;
		const c = new Chart(
			canvas,
			untrack(() => config)
		);
		chart = c;
		untrack(() => onready?.(c));
		return () => {
			c.destroy();
			chart = null;
		};
	});
	$effect(() => {
		const cfg = config;
		if (!chart) return;
		chart.data = cfg.data;
		chart.options = cfg.options ?? {};
		chart.update();
	});
</script>

<div class="relative {cls}">
	<canvas bind:this={canvas} role="img" aria-label={label} {...rest}></canvas>
</div>
