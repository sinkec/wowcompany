<script lang="ts">
	// Kartica runa v seznamu (/runs in zavihek na strani junaka): slika dungeona levo, desno naslov z
	// izidom in časom, datum, party, spodaj poravnani podatki (snemalec, vodja, smrti, loot, nagrade).
	import Tip from './Tip.svelte';
	import DungeonImage from './DungeonImage.svelte';
	import Skull from '@lucide/svelte/icons/skull';
	import Clock from '@lucide/svelte/icons/clock';
	import Crown from '@lucide/svelte/icons/crown';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Backpack from '@lucide/svelte/icons/backpack';
	import Trophy from '@lucide/svelte/icons/trophy';
	import type { RunListItem } from '#convex/lib/runsView.js';
	import { classColor } from '#lib/wow.js';
	import { durationQuip, fmtDuration, resultBadge } from '#lib/runs.js';
	import { fmtWhen } from '#lib/datetime.svelte.js';

	let { run, highlight }: { run: RunListItem; highlight?: string } = $props();
	const badge = $derived(resultBadge(run.result));
	const TONE = {
		good: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
		mid: 'border-primary/50 bg-primary/15 text-primary',
		bad: 'border-destructive/50 bg-destructive/15 text-red-300'
	};
</script>

<a
	href="/runs/{run.id}"
	class="wow-frame group flex overflow-hidden rounded-lg transition hover:-translate-y-0.5 hover:border-primary/80"
>
	<DungeonImage zone={run.zone} class="hidden w-36 shrink-0 sm:block md:w-44" />
	<div class="min-w-0 flex-1 space-y-2.5 p-4">
		<!-- naslov + izid | trajanje -->
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<div class="flex flex-wrap items-center gap-2">
					<h3
						class="font-display text-lg leading-tight font-semibold text-primary group-hover:underline"
					>
						{run.zone}
					</h3>
					<span class="rounded border px-2 py-0.5 text-xs font-semibold {TONE[badge.tone]}"
						>{badge.text}</span
					>
					{#if run.result.wipes}
						<span class="rounded border border-destructive/40 px-2 py-0.5 text-xs text-red-300"
							>💀 {run.result.wipes} wipe{run.result.wipes === 1 ? '' : 's'}</span
						>
					{/if}
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">{fmtWhen(run.startedAt)}</p>
			</div>
			<div class="shrink-0 text-right">
				<div class="flex items-center justify-end gap-1.5 text-lg font-semibold tabular-nums">
					<Clock class="size-4 text-primary/70" />
					{fmtDuration(run.durationMs)}
				</div>
				<p class="hidden max-w-52 text-[11px] text-muted-foreground italic sm:block">
					{durationQuip(run.durationMs)}
				</p>
			</div>
		</div>

		<!-- party -->
		<div class="flex flex-wrap gap-1.5">
			{#each run.party as p (p.slug)}
				<span
					class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-sm {p.slug ===
					highlight
						? 'ring-1 ring-primary'
						: ''}"
					style="color: {classColor(p.classId ?? undefined)}"
				>
					{p.name}
					{#if p.deaths}<span class="text-xs text-red-300">☠{p.deaths}</span>{/if}
				</span>
			{/each}
		</div>

		<!-- podatki: vsak element v eni vrstici, ikona + oznaka + vrednost -->
		<div
			class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/40 pt-2 text-xs text-muted-foreground"
		>
			<span class="inline-flex items-center gap-1 whitespace-nowrap">
				<Megaphone class="size-3.5 shrink-0" /> Snitched by
				<b class="text-foreground">{run.recordedBy.map((r) => r.name).join(', ')}</b>
			</span>
			<Tip
				class="items-center gap-1 whitespace-nowrap"
				text={run.leader ? null : "The combat log doesn't say who leads the group. The addon does."}
			>
				<Crown class="size-3.5 shrink-0" /> Leader
				<b class="text-foreground">{run.leader ?? 'unknown'}</b>
			</Tip>
			{#if run.totalDeaths != null}
				<span class="inline-flex items-center gap-1 whitespace-nowrap"
					><Skull class="size-3.5 shrink-0" />
					{run.totalDeaths} death{run.totalDeaths === 1 ? '' : 's'}</span
				>
			{/if}
			{#if run.lootCount}
				<span class="inline-flex items-center gap-1 whitespace-nowrap"
					><Backpack class="size-3.5 shrink-0" />
					{run.lootCount} item{run.lootCount === 1 ? '' : 's'} looted</span
				>
			{/if}
			{#if run.awards?.length}
				<span class="inline-flex min-w-0 items-center gap-1"
					><Trophy class="size-3.5 shrink-0 text-primary/80" />
					<span class="truncate"
						>{run.awards
							.slice(0, 3)
							.map((a) => a.title)
							.join(' · ')}</span
					></span
				>
			{/if}
		</div>
	</div>
</a>
