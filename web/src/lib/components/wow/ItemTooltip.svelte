<script lang="ts">
	// Vsebina tooltipa predmeta v slogu WoW – ena komponenta za opremo junaka (ItemSlot) in za loot
	// runov (ItemLink). Prva vrstica je ime v barvi kakovosti.
	import type { TooltipLine } from '#lib/types.js';
	let { lines, color }: { lines: TooltipLine[]; color?: string } = $props();
</script>

{#each lines as line, i (i)}
	<div
		class="flex justify-between gap-4 leading-snug {i === 0
			? 'mb-0.5 text-base font-semibold'
			: ''}"
		style="color: {i === 0 ? color : (line.color ?? '#ffffff')}"
	>
		<span>{line.text}</span>
		{#if line.right}<span>{line.right}</span>{/if}
	</div>
{/each}
