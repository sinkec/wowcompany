<script lang="ts">
	// Plošča na naslovnici: naslov + povezava "vse", spodaj kartica FIKSNE višine (brez praznin ob
	// sosednji plošči); več vsebine = drsnik znotraj kartice.
	import type { Snippet } from 'svelte';
	import * as Card from '#lib/components/ui/card/index.js';

	let {
		title,
		href,
		more,
		id,
		end,
		children
	}: {
		title: string;
		href: string;
		more: string;
		id: string;
		/** besedilo pod zadnjim elementom; zapolni ostanek kartice, ko je elementov malo */
		end?: string;
		children: Snippet;
	} = $props();
</script>

<section class="flex min-w-0 flex-col gap-3" aria-labelledby={id}>
	<div class="flex items-baseline justify-between gap-2">
		<h2 {id} class="section-title">{title}</h2>
		<a {href} class="shrink-0 text-sm text-primary hover:underline">{more} →</a>
	</div>
	<Card.Root class="wow-scroll flex h-[19.5rem] flex-col overflow-y-auto overscroll-contain">
		{@render children()}
		{#if end}
			<a
				{href}
				class="flex min-h-12 flex-1 items-center justify-center border-t border-border/40 px-4 py-3 text-center text-xs text-muted-foreground italic hover:text-primary"
				>{end}</a
			>
		{/if}
	</Card.Root>
</section>
