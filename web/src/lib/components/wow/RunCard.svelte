<script lang="ts">
	// Ena vrstica v seznamu runov (/runs in zavihek na strani junaka).
	import Skull from '@lucide/svelte/icons/skull';
	import Clock from '@lucide/svelte/icons/clock';
	import Crown from '@lucide/svelte/icons/crown';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import type { RunListItem } from '#convex/lib/runsView.js';
	import { classColor } from '#lib/wow.js';
	import { durationQuip, fmtDuration, fmtWhen, resultBadge } from '#lib/runs.js';

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
	class="wow-frame group block rounded-lg p-4 transition hover:-translate-y-0.5 hover:border-primary/80"
>
	<div class="flex flex-wrap items-start gap-x-4 gap-y-2">
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<h3 class="font-display text-lg font-semibold text-primary group-hover:underline">
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
			<p class="text-xs text-muted-foreground">{fmtWhen(run.startedAt)}</p>
		</div>
		<div class="text-right">
			<div class="flex items-center justify-end gap-1.5 text-lg font-semibold tabular-nums">
				<Clock class="size-4 text-primary/70" />
				{fmtDuration(run.durationMs)}
			</div>
			<p class="max-w-56 text-[11px] text-muted-foreground italic">
				{durationQuip(run.durationMs)}
			</p>
		</div>
	</div>

	<div class="mt-3 flex flex-wrap gap-1.5">
		{#each run.party as p (p.slug)}
			<span
				class="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-sm {p.slug ===
				highlight
					? 'ring-1 ring-primary'
					: ''}"
				style="color: {classColor(p.classId ?? undefined)}"
			>
				{p.name}
				{#if p.deaths}<span class="ml-1 text-xs text-red-300">☠{p.deaths}</span>{/if}
			</span>
		{/each}
	</div>

	<div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
		<span class="flex items-center gap-1">
			<Megaphone class="size-3.5" /> Snitched by
			<b class="text-foreground">{run.recordedBy.map((r) => r.name).join(', ')}</b>
		</span>
		<span
			class="flex items-center gap-1"
			title="The combat log doesn't say who leads the group. Coming with the addon."
		>
			<Crown class="size-3.5" /> Leader
			<b class="text-foreground">{run.leader ?? 'unknown (nobody admits it)'}</b>
		</span>
		{#if run.totalDeaths != null}
			<span class="flex items-center gap-1"
				><Skull class="size-3.5" />
				{run.totalDeaths} death{run.totalDeaths === 1 ? '' : 's'}</span
			>
		{/if}
		{#if run.lootCount}
			<span>🎒 {run.lootCount} item{run.lootCount === 1 ? '' : 's'} looted</span>
		{/if}
		{#if run.awards?.length}
			<span class="truncate"
				>🏆 {run.awards
					.slice(0, 3)
					.map((a) => a.title)
					.join(' · ')}</span
			>
		{/if}
	</div>
</a>
