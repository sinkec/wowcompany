<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	// Zavihek Logs na strani junaka: Company Parses po bossih (docs/STATS.md §6).
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import Locked from '#lib/components/wow/Locked.svelte';
	import { ROLE_LABEL, fmtDuration, fmtRate, fmtWhen, parseColor, parseQuip } from '#lib/runs.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import SortHead from '#lib/components/table/SortHead.svelte';
	import SeasonPicker from './SeasonPicker.svelte';
	import { TableSort } from '#lib/sort.svelte.js';

	let { slug }: { slug: string } = $props();
	let season = $state<number | undefined>(undefined);
	let open = $state<string | null>(null);
	const q = useQuery(api.runs.heroLogs, () => ({ slug, ...(season ? { season } : {}) }));
	const d = $derived(q.data);
	const key = (e: { encounterId: number; role: string }) => `${e.encounterId}:${e.role}`;
	const zones = $derived.by(() => {
		if (!d || d.locked) return [];
		const m = new Map<string, typeof d.encounters>();
		for (const e of d.encounters) m.set(e.zone, [...(m.get(e.zone) ?? []), e]);
		return [...m.entries()];
	});
	type Enc = Extract<NonNullable<typeof d>, { locked: false }>['encounters'][number];
	type Kill = Enc['list'][number];
	// sort je skupen vsem tabelam (dungeonom) in vsem razprtim seznamom killov
	const bossSort = new TableSort<'boss' | 'bestPct' | 'best' | 'medianPct' | 'kills' | 'fastest'>();
	const bossValue = {
		boss: (e: Enc) => e.encounter,
		bestPct: (e: Enc) => e.bestPct,
		best: (e: Enc) => e.best,
		medianPct: (e: Enc) => e.medianPct,
		kills: (e: Enc) => e.kills,
		// manj časa je bolje: "padajoče" = najhitrejši zgoraj
		fastest: (e: Enc) => (e.fastestMs ? -e.fastestMs : null)
	};
	const killSort = new TableSort<'when' | 'pct' | 'rank' | 'value' | 'ilvl' | 'duration'>('when');
	const killValue = {
		when: (k: Kill) => k.at,
		pct: (k: Kill) => k.pct,
		rank: (k: Kill) => -k.rank,
		value: (k: Kill) => k.value,
		ilvl: (k: Kill) => k.ilvl,
		duration: (k: Kill) => -k.durationMs
	};
	const pctText = (p: number | null) => (p === null ? '—' : String(Math.floor(p)));
	const nameOf = (s: string) =>
		d && !d.locked ? (d.people.find((p) => p.slug === s)?.name ?? s) : s;
</script>

{#if d?.locked}
	<Locked what="their parses (and how bad they really are)" />
{:else if d}
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div class="flex flex-wrap gap-3">
			<Card.Root class="px-4 py-2">
				<div class="eyebrow">Best Perf. Avg</div>
				<div class="text-2xl font-bold tabular-nums" style="color: {parseColor(d.bestPerfAvg)}">
					{pctText(d.bestPerfAvg)}
				</div>
			</Card.Root>
			<Card.Root class="px-4 py-2">
				<div class="eyebrow">Median Perf. Avg</div>
				<div class="text-2xl font-bold tabular-nums" style="color: {parseColor(d.medianPerfAvg)}">
					{pctText(d.medianPerfAvg)}
				</div>
			</Card.Root>
		</div>
		<SeasonPicker seasons={d.seasons} current={d.season} onpick={(n) => (season = n)} />
	</div>

	{#if !d.encounters.length}
		<Card.Root class="p-6 text-center text-sm text-muted-foreground">
			No boss kills on file this season. Parses come from dungeon runs recorded by the
			<a href="/link" class="text-primary hover:underline">Companion</a> – kill something first.
		</Card.Root>
	{/if}

	{#each zones as [zone, list] (zone)}
		<Card.Root class="overflow-hidden">
			<h3 class="border-b border-border/50 px-4 py-2 text-sm font-semibold text-primary">{zone}</h3>
			<Table.Root>
				<Table.Header>
					<Table.Row class="text-xs hover:bg-transparent">
						<SortHead sort={bossSort} key="boss" first="asc" class="px-3">Boss</SortHead>
						<SortHead sort={bossSort} key="bestPct" align="right" class="px-3">Best %</SortHead>
						<SortHead sort={bossSort} key="best" align="right" class="px-3">Best</SortHead>
						<SortHead
							sort={bossSort}
							key="medianPct"
							align="right"
							class="hidden px-3 sm:table-cell">Median %</SortHead
						>
						<SortHead sort={bossSort} key="kills" align="right" class="px-3">Kills</SortHead>
						<SortHead sort={bossSort} key="fastest" align="right" class="hidden px-3 sm:table-cell"
							>Fastest</SortHead
						>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each bossSort.apply(list, bossValue) as e (key(e))}
						<Table.Row
							class="cursor-pointer"
							aria-expanded={open === key(e)}
							onclick={() => (open = open === key(e) ? null : key(e))}
						>
							<Table.Cell class="px-3">
								{e.encounter}
								<span class="ml-1 text-xs text-muted-foreground">{ROLE_LABEL[e.role]}</span>
							</Table.Cell>
							<Table.Cell
								class="px-3 text-right font-semibold tabular-nums"
								style="color: {parseColor(e.bestPct)}">{pctText(e.bestPct)}</Table.Cell
							>
							<Table.Cell class="px-3 text-right tabular-nums"
								>{fmtRate(e.best)}
								<span class="text-xs text-muted-foreground"
									>{e.role === 'heal' ? 'hps' : 'dps'}</span
								></Table.Cell
							>
							<Table.Cell
								class="hidden px-3 text-right tabular-nums sm:table-cell"
								style="color: {parseColor(e.medianPct)}">{pctText(e.medianPct)}</Table.Cell
							>
							<Table.Cell class="px-3 text-right tabular-nums">{e.kills}</Table.Cell>
							<Table.Cell class="hidden px-3 text-right tabular-nums sm:table-cell"
								>{fmtDuration(e.fastestMs)}</Table.Cell
							>
						</Table.Row>
						{#if open === key(e)}
							<Table.Row class="bg-muted/20 hover:bg-muted/20">
								<Table.Cell colspan={6} class="px-3 py-2 whitespace-normal">
									<p class="mb-2 text-xs text-muted-foreground italic">{parseQuip(e.bestPct)}</p>
									{#if e.top}
										<p class="mb-2 text-xs">
											{#if e.top.slug === slug}
												<span class="text-primary">Company best on this boss.</span> Everyone else is
												chasing you.
											{:else}
												Company best:
												<a href="/c/{e.top.slug}" class="font-semibold hover:underline"
													>{nameOf(e.top.slug)}</a
												>
												<a
													href="/runs/{e.top.runId}?tab=bosses"
													class="tabular-nums hover:underline">{fmtRate(e.top.value)}</a
												>
												· your best is
												<b class="tabular-nums"
													>{Math.round((e.best / Math.max(e.top.value, 0.1)) * 100)}%</b
												> of that.
											{/if}
										</p>
									{/if}
									<Table.Root class="text-xs">
										<Table.Header>
											<Table.Row class="hover:bg-transparent">
												<SortHead sort={killSort} key="when" class="h-8">When</SortHead>
												<SortHead sort={killSort} key="pct" align="right" class="h-8">%</SortHead>
												<SortHead sort={killSort} key="rank" align="right" class="h-8"
													>Rank</SortHead
												>
												<SortHead sort={killSort} key="value" align="right" class="h-8"
													>{e.role === 'heal' ? 'HPS' : 'DPS'}</SortHead
												>
												<SortHead sort={killSort} key="ilvl" align="right" class="h-8"
													>ilvl</SortHead
												>
												<SortHead sort={killSort} key="duration" align="right" class="h-8"
													>Duration</SortHead
												>
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{#each killSort.apply(e.list, killValue) as k (k.runId + k.at)}
												<Table.Row onclick={(ev) => ev.stopPropagation()}>
													<Table.Cell class="py-1">
														<a href="/runs/{k.runId}" class="hover:text-primary hover:underline"
															>{fmtWhen(k.at)}</a
														>
													</Table.Cell>
													<Table.Cell
														class="py-1 text-right font-semibold tabular-nums"
														style="color: {parseColor(k.pct)}">{pctText(k.pct)}</Table.Cell
													>
													<Table.Cell class="py-1 text-right tabular-nums"
														>{k.rank} / {k.outOf}</Table.Cell
													>
													<Table.Cell class="py-1 text-right tabular-nums"
														>{fmtRate(k.value)}</Table.Cell
													>
													<Table.Cell class="py-1 text-right tabular-nums"
														>{k.ilvl ?? '—'}</Table.Cell
													>
													<Table.Cell class="py-1 text-right tabular-nums"
														>{fmtDuration(k.durationMs)}</Table.Cell
													>
												</Table.Row>
											{/each}
										</Table.Body>
									</Table.Root>
								</Table.Cell>
							</Table.Row>
						{/if}
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Root>
	{/each}
	<p class="text-xs text-muted-foreground">
		Company Parses: each kill against every other tracked hero's best on the same boss and role,
		this season. Fewer than 4 rivals = rank only. Tanks get ranked, not graded – nobody wants that
		conversation.
	</p>
{/if}
