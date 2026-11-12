<script lang="ts">
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { RosterEntry } from '#lib/types.js';
	import { ago, classColor, fmt } from '#lib/wow.js';
	import Locked from './Locked.svelte';

	let { c }: { c: RosterEntry } = $props();
	const s = $derived(c.summary);
	const color = $derived(classColor(s?.classId));
</script>

<a
	href="/c/{c.slug}"
	class="wow-frame group relative block overflow-hidden rounded-lg p-4 transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
	style="--cc: {color}"
>
	<div class="absolute inset-x-0 top-0 h-0.5" style="background: var(--cc)"></div>
	<div class="flex items-center gap-4">
		<div class="relative shrink-0">
			{#if s?.avatar}
				<img src={s.avatar} alt="" class="size-16 rounded-full border-2 object-cover" style="border-color: var(--cc)" />
			{:else}
				<div class="grid size-16 place-items-center rounded-full border-2 bg-muted font-display text-xl" style="border-color: var(--cc)">
					{c.displayName[0]}
				</div>
			{/if}
			{#if s?.level != null}
				<span
					class="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border border-primary/60 bg-background text-xs font-bold text-primary"
				>
					{s.level}
				</span>
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<div class="truncate font-display text-lg font-semibold" style="color: var(--cc)">{c.displayName}</div>
			{#if s}
				<div class="truncate text-sm text-muted-foreground">{s.race ?? ''} {s.className ?? ''}</div>
				{#if s.talentBuild}<div class="truncate text-xs text-primary/90">{s.talentSpec} · {s.talentBuild}</div>{/if}
				{#if s.guild}<div class="truncate text-xs text-muted-foreground/80">&lt;{s.guild}&gt;</div>{/if}
			{:else}
				<div class="text-sm text-muted-foreground italic">awaiting Blizzard's blessing…</div>
			{/if}
		</div>
	</div>

	{#if s}
		<dl class="mt-4 grid grid-cols-3 gap-2 text-center">
			{#each [
				{ l: 'ilvl', v: s.ilvlEquipped },
				{ l: 'Murders', v: s.kills },
				{ l: 'Deaths', v: s.deaths }
			] as t (t.l)}
				<div class="rounded-md bg-background/40 py-1.5">
					<dt class="text-[10px] tracking-wider text-muted-foreground uppercase">{t.l}</dt>
					<dd class="font-semibold tabular-nums">{#if t.v == null}<Locked compact />{:else}{fmt(t.v)}{/if}</dd>
				</div>
			{/each}
		</dl>
	{/if}

	<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
		{#if (c.week?.level ?? 0) > 0}
			<Badge variant="secondary" class="gap-1 text-[#1eff00]"><TrendingUp class="size-3" /> +{c.week?.level} lvl this week</Badge>
		{/if}
		{#if s?.lastLogin}<span class="ml-auto">last seen {ago(s.lastLogin)}</span>{/if}
	</div>
</a>
