<script lang="ts">
	// Company lestvice (docs/STATS.md W5): po dungeonu in bossu najboljši DPS/HPS + najhitrejši cleari.
	import { useQuery } from 'convex-svelte';
	import Trophy from '@lucide/svelte/icons/trophy';
	import { api } from '#convex/_generated/api.js';
	import Locked from '#lib/components/wow/Locked.svelte';
	import { fmtDuration, fmtRate, fmtWhen } from '#lib/runs.js';
	import { classColor } from '#lib/wow.js';

	let season = $state<number | undefined>(undefined);
	const q = useQuery(api.runs.rankings, () => (season ? { season } : {}));
	const d = $derived(q.data);
	const MEDAL = ['🥇', '🥈', '🥉'];
	const people = $derived(new Map(d && !d.locked ? d.people.map((p) => [p.slug, p] as const) : []));
	const nameOf = (slug: string) => people.get(slug)?.name ?? slug;
</script>

<svelte:head><title>Rankings — WowCompany</title></svelte:head>

<div class="space-y-6">
	<section class="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
		<div class="min-w-0 space-y-1 sm:flex-1">
			<h1 class="flex items-center gap-3 text-3xl font-bold text-primary md:text-4xl">
				<Trophy class="size-8" /> Rankings
			</h1>
			<p class="text-muted-foreground">
				Best boss kill per hero, per season. Numbers from the Companion's combat logs, bragging
				rights from you. Healers get their own board so they stop complaining.
			</p>
		</div>
		{#if d && !d.locked && d.seasons.length > 1}
			<div class="flex flex-wrap gap-1 text-sm">
				{#each d.seasons as s (s.number)}
					<button
						class="rounded-md border px-3 py-1 {s.number === d.season
							? 'border-primary text-primary'
							: 'border-border text-muted-foreground hover:text-foreground'}"
						onclick={() => (season = s.number)}>{s.name}</button
					>
				{/each}
			</div>
		{/if}
	</section>

	{#if d?.locked}
		<Locked what="who parses grey (and who carries)" />
	{:else if !d}
		<div class="space-y-3">
			{#each [1, 2] as i (i)}<div class="h-40 animate-pulse rounded-lg bg-muted"></div>{/each}
		</div>
	{:else}
		{#snippet who(slug: string)}
			<a
				href="/c/{slug}"
				class="truncate font-semibold hover:underline"
				style="color: {classColor(people.get(slug)?.classId ?? undefined)}">{nameOf(slug)}</a
			>
		{/snippet}

		{#if d.speed.length}
			<section class="wow-frame rounded-lg p-4">
				<h2 class="font-display text-lg font-semibold text-primary">Speed demons</h2>
				<p class="text-xs text-muted-foreground italic">
					fastest full clears. skipping the trash is a lifestyle.
				</p>
				<div class="mt-3 grid gap-4 md:grid-cols-2">
					{#each d.speed as z (z.zone)}
						<div>
							<div class="mb-1 text-sm font-semibold">{z.zone}</div>
							{#each z.runs as r, i (r.id)}
								<a
									href="/runs/{r.id}"
									class="flex items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/30"
								>
									<span class="w-5">{MEDAL[i] ?? `${i + 1}.`}</span>
									<span class="font-semibold text-primary tabular-nums"
										>{fmtDuration(r.durationMs)}</span
									>
									<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
										>{r.party.map(nameOf).join(', ')}</span
									>
									<span class="text-xs text-muted-foreground tabular-nums"
										>{r.deaths ? `${r.deaths}☠` : ''} {fmtWhen(r.startedAt)}</span
									>
								</a>
							{/each}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if !d.boards.length}
			<div class="wow-frame rounded-lg p-10 text-center text-sm text-muted-foreground">
				No boss kills this season yet. The ladder is empty, the throne is open, the bosses are
				laughing.
			</div>
		{/if}

		{#each d.boards as z (z.zone)}
			<section class="space-y-3">
				<h2 class="font-display text-xl font-semibold text-primary">{z.zone}</h2>
				<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
					{#each z.bosses as b (b.encounterId + ':' + b.difficultyId)}
						<div class="wow-frame rounded-lg p-4">
							<h3 class="font-semibold">{b.encounter}</h3>
							{#each [{ title: 'Damage', list: b.dps, unit: 'dps' }, { title: 'Healing', list: b.heal, unit: 'hps' }] as board (board.title)}
								{#if board.list.length}
									<div class="mt-2 text-xs tracking-wide text-muted-foreground uppercase">
										{board.title}
									</div>
									{#each board.list as e, i (e.slug)}
										<div class="flex items-baseline gap-2 text-sm">
											<span class="w-5 text-xs">{MEDAL[i] ?? `${i + 1}.`}</span>
											<span class="min-w-0 flex-1 truncate">{@render who(e.slug)}</span>
											<a
												href="/runs/{e.runId}?tab=bosses"
												class="tabular-nums hover:text-primary hover:underline"
												title="{fmtWhen(e.at)} · {fmtDuration(e.durationMs)}{e.ilvl
													? ` · ilvl ${e.ilvl}`
													: ''}">{fmtRate(e.value)}</a
											>
											<span class="text-xs text-muted-foreground">{board.unit}</span>
										</div>
									{/each}
								{/if}
							{/each}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>
