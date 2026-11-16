<script lang="ts">
	// Company lestvice (docs/STATS.md W5): po dungeonu in bossu najboljši DPS/HPS + najhitrejši cleari.
	import { useQuery } from 'convex-svelte';
	import Trophy from '@lucide/svelte/icons/trophy';
	import { api } from '#convex/_generated/api.js';
	import Locked from '#lib/components/wow/Locked.svelte';
	import { fmtDuration, fmtMoney, fmtNum, fmtRate, fmtWhen } from '#lib/runs.js';
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
			<h1 class="page-title flex items-center gap-3">
				<Trophy class="size-8" /> Rankings
			</h1>
			<p class="page-lead">
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
				<h2 class="card-title">Speed demons</h2>
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

		{#if d.value.length}
			<section class="wow-frame rounded-lg p-4">
				<h2 class="card-title">Best value</h2>
				<p class="text-xs text-muted-foreground italic">
					average experience and coin per hour inside, from whoever had the Companion running. time
					is money, and you are broke.
				</p>
				<table class="mt-3 w-full text-sm">
					<thead class="text-xs text-muted-foreground">
						<tr class="border-b border-border/50">
							<th class="py-1 text-left">Dungeon</th>
							<th class="py-1 text-right">XP / hour</th>
							<th class="py-1 text-right">Coin / hour</th>
							<th class="py-1 text-right">Runs</th>
						</tr>
					</thead>
					<tbody>
						{#each d.value as z (z.zone)}
							<tr class="border-b border-border/30 last:border-0">
								<td class="py-1">{z.zone}</td>
								<td class="py-1 text-right tabular-nums">{fmtNum(z.xpPerHour)}</td>
								<td class="py-1 text-right tabular-nums">{fmtMoney(z.copperPerHour)}</td>
								<td class="py-1 text-right tabular-nums">{z.runs}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		{#if d.mashers.length}
			<section class="wow-frame rounded-lg p-4">
				<h2 class="card-title">Keyboard Hall of Shame</h2>
				<p class="text-xs text-muted-foreground italic">
					button presses before the spell was ready, per hour inside. only counts whoever had the
					Companion running – the game logs failed casts for the log owner alone.
				</p>
				{#each d.mashers as m, i (m.slug)}
					<div class="flex items-baseline gap-2 text-sm">
						<span class="w-5 text-xs">{MEDAL[i] ?? `${i + 1}.`}</span>
						<span class="min-w-0 flex-1 truncate">{@render who(m.slug)}</span>
						<span class="tabular-nums">{fmtNum(m.perHour)}</span>
						<span class="text-xs text-muted-foreground">mashes/h · {fmtNum(m.spam)} total</span>
					</div>
				{/each}
			</section>
		{/if}

		{#if !d.boards.length}
			<div class="wow-frame rounded-lg p-10 text-center text-sm text-muted-foreground">
				No boss kills this season yet. The ladder is empty, the throne is open, the bosses are
				laughing.
			</div>
		{/if}

		{#each d.boards as z (z.zone)}
			{@const stars = d.stars.find((x) => x.zone === z.zone)?.heroes ?? []}
			<section class="space-y-3">
				<h2 class="section-title">{z.zone}</h2>
				{#if stars.length}
					<div
						class="wow-frame flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg px-4 py-2 text-sm"
					>
						<span
							class="eyebrow"
							title="Each boss: 120 points for the company's best, the rest in proportion. Summed over the dungeon."
							>All-Stars</span
						>
						{#each stars.slice(0, 8) as h, i (h.slug)}
							<span class="flex items-baseline gap-1">
								<span class="text-xs">{MEDAL[i] ?? `${i + 1}.`}</span>
								{@render who(h.slug)}
								<span class="text-primary tabular-nums">{h.points.toFixed(1)}</span>
							</span>
						{/each}
					</div>
				{/if}
				<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
					{#each z.bosses as b (b.encounterId + ':' + b.difficultyId)}
						<div class="wow-frame rounded-lg p-4">
							<h3 class="font-semibold">{b.encounter}</h3>
							{#each [{ title: 'Damage', list: b.dps, unit: 'dps' }, { title: 'Healing', list: b.heal, unit: 'hps' }] as board (board.title)}
								{#if board.list.length}
									<div class="eyebrow mt-2">
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
