<script lang="ts">
	// Izbira sezone lestvic (Rankings, Logs na strani junaka). Skrito, ko je sezona ena sama.
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';

	let {
		seasons,
		current,
		onpick
	}: {
		seasons: { number: number; name: string }[];
		current: number;
		onpick: (n: number) => void;
	} = $props();
</script>

{#if seasons.length > 1}
	<ToggleGroup.Root
		type="single"
		variant="outline"
		size="sm"
		aria-label="Season"
		bind:value={() => String(current), (v) => v && onpick(Number(v))}
	>
		{#each seasons as s (s.number)}
			<ToggleGroup.Item value={String(s.number)}>{s.name}</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>
{/if}
