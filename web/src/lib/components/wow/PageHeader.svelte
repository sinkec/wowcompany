<script lang="ts">
	// Glava strani po design rules (layout.css): ikona, naslov, podnaslov, dejanja desno.
	import type { Component, Snippet } from 'svelte';

	let {
		title,
		lead,
		icon: Icon,
		actions
	}: { title: string; lead?: string; icon?: Component<{ class?: string }>; actions?: Snippet } =
		$props();
</script>

<header class="flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="page-title flex items-center gap-3">
			{#if Icon}<Icon class="size-8 shrink-0" />{/if}{title}
		</h1>
		{#if lead}<p class="page-lead">{lead}</p>{/if}
	</div>
	{#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
</header>
