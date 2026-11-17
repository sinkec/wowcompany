<script lang="ts">
	// Slika dungeona (Blizzardova javna ploščica cone). Poskusi ime, nato brez "The"; brez slike (npr.
	// Forevrovi posebni dungeoni) tematski nadomestek z začetnico.
	import { dungeonTile } from '#lib/wow.js';

	let { zone, class: cls = '' }: { zone: string; class?: string } = $props();
	const candidates = $derived(
		[dungeonTile(zone), dungeonTile(zone.replace(/^the\s+/i, ''))].filter(
			(u, i, a) => a.indexOf(u) === i
		)
	);
	let tried = $state(0);
	$effect(() => {
		void zone;
		tried = 0;
	});
</script>

<div class="relative overflow-hidden bg-muted {cls}">
	{#if tried < candidates.length}
		<img
			src={candidates[tried]}
			alt=""
			loading="lazy"
			class="size-full object-cover transition-transform duration-500 group-hover:scale-105"
			onerror={() => tried++}
		/>
	{:else}
		<div
			class="grid size-full place-items-center bg-[radial-gradient(circle_at_30%_20%,oklch(0.45_0.09_70/45%),transparent_70%)]"
		>
			<span class="font-display text-4xl font-bold text-primary/50"
				>{zone.replace(/^the\s+/i, '')[0]}</span
			>
		</div>
	{/if}
	<div
		class="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-black/40"
	></div>
</div>
