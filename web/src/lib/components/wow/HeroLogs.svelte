<script lang="ts">
	// Zavihek Logs na strani junaka: Company Parses po bossih (docs/STATS.md §6).
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import Locked from '#lib/components/wow/Locked.svelte';
	import { ROLE_LABEL, fmtDuration, fmtRate, fmtWhen, parseColor, parseQuip } from '#lib/runs.js';

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
	const pctText = (p: number | null) => (p === null ? '—' : String(Math.floor(p)));
	const nameOf = (s: string) =>
		d && !d.locked ? (d.people.find((p) => p.slug === s)?.name ?? s) : s;
</script>

{#if d?.locked}
	<Locked what="their parses (and how bad they really are)" />
{:else if d}
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div class="flex flex-wrap gap-3">
			<div class="wow-frame rounded-lg px-4 py-2">
				<div class="text-xs tracking-wide text-muted-foreground uppercase">Best Perf. Avg</div>
				<div class="text-2xl font-bold tabular-nums" style="color: {parseColor(d.bestPerfAvg)}">
					{pctText(d.bestPerfAvg)}
				</div>
			</div>
			<div class="wow-frame rounded-lg px-4 py-2">
				<div class="text-xs tracking-wide text-muted-foreground uppercase">Median Perf. Avg</div>
				<div class="text-2xl font-bold tabular-nums" style="color: {parseColor(d.medianPerfAvg)}">
					{pctText(d.medianPerfAvg)}
				</div>
			</div>
		</div>
		{#if d.seasons.length > 1}
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
	</div>

	{#if !d.encounters.length}
		<div class="wow-frame rounded-lg p-6 text-center text-sm text-muted-foreground">
			No boss kills on file this season. Parses come from dungeon runs recorded by the
			<a href="/link" class="text-primary hover:underline">Companion</a> – kill something first.
		</div>
	{/if}

	{#each zones as [zone, list] (zone)}
		<section class="wow-frame overflow-hidden rounded-lg">
			<h3 class="border-b border-border/50 px-4 py-2 text-sm font-semibold text-primary">{zone}</h3>
			<table class="w-full text-sm">
				<thead class="text-xs text-muted-foreground">
					<tr class="border-b border-border/50">
						<th class="px-3 py-2 text-left">Boss</th>
						<th class="px-3 py-2 text-right">Best %</th>
						<th class="px-3 py-2 text-right">Best</th>
						<th class="hidden px-3 py-2 text-right sm:table-cell">Median %</th>
						<th class="px-3 py-2 text-right">Kills</th>
						<th class="hidden px-3 py-2 text-right sm:table-cell">Fastest</th>
					</tr>
				</thead>
				<tbody>
					{#each list as e (key(e))}
						<tr
							class="cursor-pointer border-b border-border/30 last:border-0 hover:bg-muted/30"
							onclick={() => (open = open === key(e) ? null : key(e))}
						>
							<td class="px-3 py-1.5">
								{e.encounter}
								<span class="ml-1 text-xs text-muted-foreground">{ROLE_LABEL[e.role]}</span>
							</td>
							<td
								class="px-3 py-1.5 text-right font-semibold tabular-nums"
								style="color: {parseColor(e.bestPct)}">{pctText(e.bestPct)}</td
							>
							<td class="px-3 py-1.5 text-right tabular-nums"
								>{fmtRate(e.best)}
								<span class="text-xs text-muted-foreground"
									>{e.role === 'heal' ? 'hps' : 'dps'}</span
								></td
							>
							<td
								class="hidden px-3 py-1.5 text-right tabular-nums sm:table-cell"
								style="color: {parseColor(e.medianPct)}">{pctText(e.medianPct)}</td
							>
							<td class="px-3 py-1.5 text-right tabular-nums">{e.kills}</td>
							<td class="hidden px-3 py-1.5 text-right tabular-nums sm:table-cell"
								>{fmtDuration(e.fastestMs)}</td
							>
						</tr>
						{#if open === key(e)}
							<tr class="border-b border-border/30 bg-muted/20">
								<td colspan="6" class="px-3 py-2">
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
									<table class="w-full text-xs">
										<thead class="text-muted-foreground">
											<tr>
												<th class="py-1 text-left">When</th>
												<th class="py-1 text-right">%</th>
												<th class="py-1 text-right">Rank</th>
												<th class="py-1 text-right">{e.role === 'heal' ? 'HPS' : 'DPS'}</th>
												<th class="py-1 text-right">ilvl</th>
												<th class="py-1 text-right">Duration</th>
											</tr>
										</thead>
										<tbody>
											{#each e.list as k (k.runId + k.at)}
												<tr>
													<td class="py-1">
														<a href="/runs/{k.runId}" class="hover:text-primary hover:underline"
															>{fmtWhen(k.at)}</a
														>
													</td>
													<td
														class="py-1 text-right font-semibold tabular-nums"
														style="color: {parseColor(k.pct)}">{pctText(k.pct)}</td
													>
													<td class="py-1 text-right tabular-nums">{k.rank} / {k.outOf}</td>
													<td class="py-1 text-right tabular-nums">{fmtRate(k.value)}</td>
													<td class="py-1 text-right tabular-nums">{k.ilvl ?? '—'}</td>
													<td class="py-1 text-right tabular-nums">{fmtDuration(k.durationMs)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</section>
	{/each}
	<p class="text-xs text-muted-foreground">
		Company Parses: each kill against every other tracked hero's best on the same boss and role,
		this season. Fewer than 4 rivals = rank only. Tanks get ranked, not graded – nobody wants that
		conversation.
	</p>
{/if}
