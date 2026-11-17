<script lang="ts">
	// En run v eni vrstici (naslovnica): dungeon, izid, trajanje, kdaj, party kot pikice razreda.
	// Klik odpre run (/runs/[id]) s polno analizo.
	import Skull from '@lucide/svelte/icons/skull';
	import type { RunListItem } from '#convex/lib/runsView.js';
	import { classColor, ago } from '#lib/wow.js';
	import { fmtDuration, resultBadge } from '#lib/runs.js';

	let { run }: { run: RunListItem } = $props();
	const badge = $derived(resultBadge(run.result));
	const TONE = { good: 'text-emerald-300', mid: 'text-primary', bad: 'text-red-300' };
</script>

<a
	href="/runs/{run.id}"
	class="group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/40"
>
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm font-semibold group-hover:text-primary">{run.zone}</p>
		<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<span class={TONE[badge.tone]}>{badge.text}</span>
			{#if run.totalDeaths}<span class="inline-flex items-center gap-0.5"
					>· <Skull class="size-3" />{run.totalDeaths}</span
				>{/if}
			<span>· {ago(run.startedAt)}</span>
		</p>
	</div>
	<div class="flex shrink-0 flex-col items-end gap-1">
		<span class="text-sm font-semibold tabular-nums">{fmtDuration(run.durationMs)}</span>
		<span class="flex gap-0.5" aria-label={run.party.map((p) => p.name).join(', ')}>
			{#each run.party as p (p.slug)}
				<span
					class="size-2 rounded-full"
					style="background: {classColor(p.classId ?? undefined)}"
					title={p.name}
				></span>
			{/each}
		</span>
	</div>
</a>
