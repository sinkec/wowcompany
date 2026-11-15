<script lang="ts">
	import * as HoverCard from '#lib/components/ui/hover-card/index.js';
	import type { Item } from '#lib/types.js';
	import { EMPTY_SLOT_JOKES, SLOT_LABELS, iconFallback, qualityColor } from '#lib/wow.js';

	let { item, slot, align = 'left' }: { item?: Item; slot: string; align?: 'left' | 'right' } = $props();
	const color = $derived(item ? qualityColor(item.quality) : undefined);
</script>

{#if item}
	<HoverCard.Root openDelay={60} closeDelay={40}>
		<HoverCard.Trigger>
			{#snippet child({ props })}
				<div
					{...props}
					class="flex items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-accent/60 {align === 'right'
						? 'flex-row-reverse text-right'
						: ''}"
				>
					<div class="size-11 shrink-0 overflow-hidden rounded-md border-2" style="border-color: {color}">
						{#if item.icon}
							<img src={item.icon} alt="" class="size-full object-cover" loading="lazy" onerror={iconFallback} />
						{:else}
							<div class="size-full bg-muted"></div>
						{/if}
					</div>
					<div class="min-w-0">
						<div class="truncate text-sm font-medium" style="color: {color}">{item.name}</div>
						<div class="text-xs text-muted-foreground">{SLOT_LABELS[slot] ?? item.slot} · ilvl {item.ilvl}</div>
					</div>
				</div>
			{/snippet}
		</HoverCard.Trigger>
		<HoverCard.Content side={align === 'right' ? 'left' : 'right'} class="wow-tooltip w-72 p-3 text-sm">
			{#each item.tooltip as line, i (i)}
				<div
					class="flex justify-between gap-4 leading-snug {i === 0 ? 'mb-0.5 text-base font-semibold' : ''}"
					style="color: {i === 0 ? color : (line.color ?? '#ffffff')}"
				>
					<span>{line.text}</span>
					{#if line.right}<span>{line.right}</span>{/if}
				</div>
			{/each}
		</HoverCard.Content>
	</HoverCard.Root>
{:else}
	<div class="flex items-center gap-3 p-1.5 opacity-45 {align === 'right' ? 'flex-row-reverse text-right' : ''}">
		<div class="size-11 shrink-0 rounded-md border border-dashed border-border bg-muted/40"></div>
		<div class="min-w-0">
			<div class="text-xs text-muted-foreground">{SLOT_LABELS[slot]}</div>
			{#if EMPTY_SLOT_JOKES[slot]}<div class="truncate text-[11px] text-muted-foreground/80 italic">{EMPTY_SLOT_JOKES[slot]}</div>{/if}
		</div>
	</div>
{/if}
