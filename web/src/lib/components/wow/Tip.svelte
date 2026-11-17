<script lang="ts">
	// Namig ob prehodu z miško (shadcn Tooltip) namesto brskalnikovega `title=`. Brez besedila = samo vsebina.
	// `as="div"` za blokovne elemente (kartice), privzeto `span` (vrstični).
	import type { Snippet } from 'svelte';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { cn } from '#lib/utils.js';

	let {
		text,
		as = 'span',
		side = 'top',
		class: cls,
		style,
		children
	}: {
		text: string | null | undefined;
		as?: 'span' | 'div';
		side?: 'top' | 'bottom' | 'left' | 'right';
		class?: string;
		style?: string;
		children?: Snippet;
	} = $props();
</script>

{#if text}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<svelte:element
					this={as}
					{...props}
					{style}
					class={cn(as === 'span' && 'inline-flex', cls)}>{@render children?.()}</svelte:element
				>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content {side} class="max-w-xs text-pretty">{text}</Tooltip.Content>
	</Tooltip.Root>
{:else if cls || style}
	<svelte:element this={as} class={cls} {style}>{@render children?.()}</svelte:element>
{:else}
	{@render children?.()}
{/if}
