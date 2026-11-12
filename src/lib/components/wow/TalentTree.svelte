<script lang="ts">
	import * as HoverCard from '#lib/components/ui/hover-card/index.js';
	import type { TalentTree } from '#lib/types.js';
	import { iconFallback } from '#lib/wow.js';

	let { tree, top = false }: { tree: TalentTree; top?: boolean } = $props();
</script>

<section class="wow-frame rounded-lg p-4 {top ? 'ring-1 ring-primary/60' : ''}">
	<div class="mb-3 flex items-baseline justify-between gap-2">
		<h3 class="font-display text-lg font-semibold {top ? 'text-primary' : ''}">{tree.name}</h3>
		<span class="font-display text-2xl font-bold tabular-nums {tree.spent ? '' : 'text-muted-foreground'}">{tree.spent}</span>
	</div>
	{#if tree.talents.length === 0}
		<p class="text-sm text-muted-foreground italic">Zero points. Pristine. Untouched. Like their gym membership.</p>
	{:else}
		<ul class="space-y-1.5">
			{#each tree.talents as t (t.id)}
				{@const maxed = t.maxRank != null && t.rank >= t.maxRank}
				<li>
					<HoverCard.Root openDelay={60} closeDelay={40}>
						<HoverCard.Trigger>
							{#snippet child({ props })}
								<div {...props} class="flex items-center gap-3 rounded-md p-1 transition-colors hover:bg-accent/60">
									<div class="relative size-9 shrink-0 overflow-hidden rounded-md border-2 {maxed ? 'border-[#ffd100]' : 'border-[#1eff00]'}">
										{#if t.icon}
											<img src={t.icon} alt="" class="size-full object-cover" loading="lazy" onerror={iconFallback} />
										{:else}
											<div class="size-full bg-muted"></div>
										{/if}
									</div>
									<span class="min-w-0 flex-1 truncate text-sm">{t.name}</span>
									<span class="shrink-0 text-xs tabular-nums {maxed ? 'text-[#ffd100]' : 'text-[#1eff00]'}">
										{t.rank}{t.maxRank ? `/${t.maxRank}` : ''}
									</span>
								</div>
							{/snippet}
						</HoverCard.Trigger>
						<HoverCard.Content side="right" class="wow-tooltip w-72 p-3 text-sm">
							<div class="text-base font-semibold text-white">{t.name}</div>
							<div class="mb-1 text-xs text-white/70">Rank {t.rank}{t.maxRank ? `/${t.maxRank}` : ''}</div>
							<p class="leading-snug text-[#ffd100]">{t.description}</p>
						</HoverCard.Content>
					</HoverCard.Root>
				</li>
			{/each}
		</ul>
	{/if}
</section>
