<script lang="ts">
	import type { RosterEntry } from '#lib/types.js';
	import { classColor, fmt } from '#lib/wow.js';
	import Locked from './Locked.svelte';

	let {
		title,
		note,
		entries,
		value,
		format = (n: number) => fmt(n),
		empty = 'Nobody qualifies. Pathetic.',
		limit = 5
	}: {
		title: string;
		note?: string;
		entries: RosterEntry[];
		value: (c: RosterEntry) => number | null | undefined;
		format?: (n: number) => string;
		empty?: string;
		limit?: number;
	} = $props();

	const rows = $derived(
		entries
			.map((c) => ({ c, v: value(c) }))
			.filter((r): r is { c: RosterEntry; v: number } => typeof r.v === 'number' && r.v > 0)
			.sort((a, b) => b.v - a.v)
			.slice(0, limit)
	);
	// vse vrednosti skrite (null/undefined) -> polje ni javno za tega gledalca
	const hidden = $derived(entries.length > 0 && entries.every((c) => value(c) == null));
	const max = $derived(Math.max(1, ...rows.map((r) => r.v)));
	const medals = ['🥇', '🥈', '🥉'];
</script>

<section class="wow-frame rounded-lg p-4">
	<h3 class="text-sm font-semibold text-primary">{title}</h3>
	{#if note}<p class="text-xs text-muted-foreground italic">{note}</p>{/if}
	{#if hidden}
		<div class="mt-3"><Locked what="this board" /></div>
	{:else if rows.length === 0}
		<p class="py-5 text-center text-sm text-muted-foreground">{empty}</p>
	{:else}
		<ol class="mt-3 space-y-2">
			{#each rows as { c, v }, i (c.slug)}
				<li>
					<a href="/c/{c.slug}" class="group block" title="{c.displayName}: {format(v)}">
						<div class="flex items-baseline justify-between gap-2 text-sm">
							<span class="truncate">
								<span class="inline-block w-5 text-center">{medals[i] ?? i + 1}</span>
								<span class="group-hover:underline">{c.displayName}</span>
							</span>
							<span class="shrink-0 font-semibold tabular-nums">{format(v)}</span>
						</div>
						<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-background/60">
							<div class="h-full rounded-full" style="width: {(v / max) * 100}%; background: {classColor(c.summary?.classId)}"></div>
						</div>
					</a>
				</li>
			{/each}
		</ol>
	{/if}
</section>
