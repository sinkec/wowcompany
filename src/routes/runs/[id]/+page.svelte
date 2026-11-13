<script lang="ts">
	import { page } from '$app/state';
	import { useQuery } from 'convex-svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Clock from '@lucide/svelte/icons/clock';
	import Crown from '@lucide/svelte/icons/crown';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Skull from '@lucide/svelte/icons/skull';
	import Trophy from '@lucide/svelte/icons/trophy';
	import { api } from '#convex/_generated/api.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import Locked from '#lib/components/wow/Locked.svelte';
	import RunTimeline from '#lib/components/wow/RunTimeline.svelte';
	import { classColor } from '#lib/wow.js';
	import {
		ACTIVE_QUIP,
		END_REASON,
		deathQuip,
		durationQuip,
		fmtDuration,
		fmtNum,
		fmtRate,
		fmtWhen,
		lootColor,
		QUALITY_NAME,
		resultBadge
	} from '#lib/runs.js';

	const id = $derived(page.params.id ?? '');
	const q = useQuery(api.runs.get, () => ({ id }));
	const run = $derived(q.data && !q.data.locked ? q.data.run : null);

	const names = $derived(Object.fromEntries((run?.party ?? []).map((p) => [p.slug, p.name])));
	const classes = $derived(Object.fromEntries((run?.party ?? []).map((p) => [p.slug, p.classId])));
	const tracked = $derived(new Set((run?.party ?? []).filter((p) => p.tracked).map((p) => p.slug)));
	const badge = $derived(run ? resultBadge(run.result) : null);
	const players = $derived([...(run?.players ?? [])].sort((a, b) => b.damage - a.damage));
	const maxDps = $derived(Math.max(1, ...players.map((p) => p.dps)));
	const maxHps = $derived(Math.max(1, ...players.map((p) => p.hps)));
	const maxTaken = $derived(Math.max(1, ...players.map((p) => p.damageTaken)));
	const totalDmg = $derived(players.reduce((n, p) => n + p.damage, 0));
	const totalHeal = $derived(players.reduce((n, p) => n + p.healing, 0));
	const bossSegs = $derived((run?.segments ?? []).filter((s) => s.kind === 'boss'));
	const totalDeaths = $derived(run?.totalDeaths ?? null);

	// ?tab=meter|bosses|deaths|timeline|spells → povezava naravnost na zavihek
	const TABS = ['meter', 'bosses', 'deaths', 'loot', 'timeline', 'spells'];
	function initialTab(a: { details: boolean; deaths: boolean; loot: boolean }) {
		const t = page.url.searchParams.get('tab') ?? '';
		const ok = (x: string) => (x === 'deaths' ? a.deaths : x === 'loot' ? a.loot : a.details);
		if (TABS.includes(t) && ok(t)) return t;
		return a.details ? 'meter' : a.deaths ? 'deaths' : 'loot';
	}

	// loot: po junaku (največ predmetov prvi) in kronološko
	const loot = $derived(run?.loot ?? []);
	const lootBy = $derived.by(() => {
		const m = new Map<string, { name: string; slug: string | null; items: number; best: number }>();
		for (const l of loot) {
			const k = l.slug ?? l.looter;
			const e = m.get(k) ?? {
				name: names[l.slug ?? ''] ?? l.looter,
				slug: l.slug,
				items: 0,
				best: -1
			};
			e.items += l.count;
			e.best = Math.max(e.best, l.quality ?? -1);
			m.set(k, e);
		}
		return [...m.values()].sort((a, b) => b.items - a.items);
	});

	let spellsFor = $state<string | null>(null);
	const spellPlayer = $derived(players.find((p) => p.slug === spellsFor) ?? players[0] ?? null);

	const TONE = {
		good: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
		mid: 'border-primary/50 bg-primary/15 text-primary',
		bad: 'border-destructive/50 bg-destructive/15 text-red-300'
	};
	const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
</script>

<svelte:head
	><title>{run ? `${run.zone} — Dungeon Runs` : 'Dungeon Run'} — WowCompany</title></svelte:head
>

<div class="space-y-6">
	<a
		href="/runs"
		class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
	>
		<ArrowLeft class="size-4" /> All runs
	</a>

	{#if q.isLoading}
		<div class="h-48 animate-pulse rounded-lg bg-muted"></div>
	{:else if q.data?.locked}
		<Locked what="our dungeon runs (and the bodies we left behind)" />
	{:else if !run}
		<div class="wow-frame rounded-lg p-10 text-center">
			<p class="text-5xl">👻</p>
			<p class="mt-2 font-display text-xl text-primary">This run doesn't exist</p>
			<p class="text-sm text-muted-foreground">
				Either it never happened or someone deleted the evidence. We don't judge. Much.
			</p>
		</div>
	{:else}
		<!-- HEADER -->
		<section class="wow-frame space-y-4 rounded-lg p-5">
			<div class="flex flex-wrap items-start gap-4">
				<div class="min-w-0 flex-1 space-y-1">
					<div class="flex flex-wrap items-center gap-2">
						<h1 class="text-3xl font-bold text-primary md:text-4xl">{run.zone}</h1>
						{#if badge}<span
								class="rounded border px-2 py-0.5 text-sm font-semibold {TONE[badge.tone]}"
								>{badge.text}</span
							>{/if}
						{#if run.result.wipes}
							<span class="rounded border border-destructive/40 px-2 py-0.5 text-sm text-red-300"
								>💀 {run.result.wipes} wipe{run.result.wipes === 1 ? '' : 's'}</span
							>
						{/if}
					</div>
					<p class="text-sm text-muted-foreground">
						{fmtWhen(run.startedAt)} · {END_REASON[run.endReason] ?? run.endReason}
					</p>
				</div>
				<div class="text-right">
					<div class="flex items-center justify-end gap-2 text-3xl font-bold tabular-nums">
						<Clock class="size-6 text-primary/70" />
						{fmtDuration(run.durationMs)}
					</div>
					<p class="text-xs text-muted-foreground italic">{durationQuip(run.durationMs)}</p>
				</div>
			</div>

			<div class="grid gap-3 text-sm sm:grid-cols-3">
				<div class="rounded-md border border-border/50 bg-background/30 p-3">
					<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Megaphone class="size-3.5" /> Snitched by
					</div>
					<div class="font-semibold">{run.recordedBy.map((r) => r.name).join(', ')}</div>
					{#if run.recordedBy.length > 1}<div class="text-xs text-muted-foreground">
							Multiple witnesses. No alibi possible.
						</div>{/if}
				</div>
				<div
					class="rounded-md border border-border/50 bg-background/30 p-3"
					title="The combat log doesn't record the group leader."
				>
					<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Crown class="size-3.5" /> Party leader
					</div>
					<div class="font-semibold">{run.leader ?? 'Unknown'}</div>
					{#if !run.leader}<div class="text-xs text-muted-foreground">
							The combat log refuses to name names. Coming with the addon.
						</div>{/if}
				</div>
				<div class="rounded-md border border-border/50 bg-background/30 p-3">
					<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Skull class="size-3.5" /> Body count
					</div>
					{#if totalDeaths != null}
						<div class="font-semibold">{totalDeaths} death{totalDeaths === 1 ? '' : 's'}</div>
						<div class="text-xs text-muted-foreground">{deathQuip(totalDeaths)}</div>
					{:else}
						<Locked compact />
					{/if}
				</div>
			</div>

			<div class="flex flex-wrap gap-1.5">
				{#each run.party as p (p.slug)}
					{#if p.tracked}
						<a
							href="/c/{p.slug}"
							class="rounded-md border border-border/60 bg-background/40 px-2.5 py-1 text-sm hover:border-primary"
							style="color: {classColor(p.classId ?? undefined)}">{p.name}</a
						>
					{:else}
						<span
							class="rounded-md border border-dashed border-border/60 px-2.5 py-1 text-sm text-muted-foreground"
							title="Not tracked on the portal. A tourist.">{p.name}</span
						>
					{/if}
				{/each}
			</div>
		</section>

		<!-- AWARDS -->
		{#if run.awards?.length}
			<section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each run.awards as a (a.key)}
					<div class="wow-frame rounded-lg p-4">
						<div class="flex items-center gap-2 font-display font-semibold text-primary">
							<Trophy class="size-4" />
							{a.title}
						</div>
						<div
							class="mt-1 text-sm font-semibold"
							style="color: {classColor(classes[a.slug] ?? undefined)}"
						>
							{names[a.slug] ?? a.slug}
						</div>
						<p class="text-xs text-muted-foreground">{a.detail}</p>
					</div>
				{/each}
			</section>
		{/if}

		{#if !run.access.details && !run.access.deaths && !run.access.loot}
			<Locked what="the meter, the bosses and the autopsy reports" />
		{:else}
			<Tabs.Root value={initialTab(run.access)}>
				<Tabs.List class="flex-wrap">
					<Tabs.Trigger value="meter" disabled={!run.access.details}>The Meter</Tabs.Trigger>
					<Tabs.Trigger value="bosses" disabled={!run.access.details}>Bosses</Tabs.Trigger>
					<Tabs.Trigger value="deaths" disabled={!run.access.deaths}>Autopsies</Tabs.Trigger>
					<Tabs.Trigger value="loot" disabled={!run.access.loot}
						>Loot{#if loot.length}&nbsp;<span class="text-xs text-muted-foreground"
								>({loot.length})</span
							>{/if}</Tabs.Trigger
					>
					<Tabs.Trigger value="timeline" disabled={!run.access.details}>Timeline</Tabs.Trigger>
					<Tabs.Trigger value="spells" disabled={!run.access.details}>Spells</Tabs.Trigger>
				</Tabs.List>

				<!-- METER -->
				<Tabs.Content value="meter" class="mt-4 space-y-4">
					{#if players.length}
						<div class="wow-frame overflow-x-auto rounded-lg">
							<table class="w-full min-w-[760px] text-sm">
								<thead class="text-xs text-muted-foreground">
									<tr class="border-b border-border/50">
										<th class="px-3 py-2 text-left">Hero</th>
										<th class="w-[22%] px-3 py-2 text-left">DPS</th>
										<th class="px-3 py-2 text-right">Damage</th>
										<th class="w-[16%] px-3 py-2 text-left">HPS</th>
										<th class="px-3 py-2 text-right" title="Healing that landed on full health bars"
											>Overheal</th
										>
										<th class="px-3 py-2 text-right">Shields</th>
										<th class="px-3 py-2 text-right">Taken</th>
										<th
											class="px-3 py-2 text-right"
											title="Lava, fire, falling, drowning – self-inflicted stupidity">Env.</th
										>
										<th class="px-3 py-2 text-right">☠</th>
										<th class="px-3 py-2 text-right" title="Interrupts">Kicks</th>
										<th class="px-3 py-2 text-right">Crit</th>
										<th class="px-3 py-2 text-right">Active</th>
									</tr>
								</thead>
								<tbody>
									{#each players as p (p.slug)}
										{@const active = pct(p.activeMs, run.durationMs)}
										<tr class="border-b border-border/30 last:border-0">
											<td class="px-3 py-2">
												<span
													class="font-semibold whitespace-nowrap"
													style="color: {classColor(p.classId ?? undefined)}">{p.name}</span
												>
												{#if p.recorder}<span
														class="ml-1 text-[10px] text-muted-foreground"
														title="Uploaded this run">📣</span
													>{/if}
											</td>
											<td class="px-3 py-2">
												<div class="flex items-center gap-2">
													<div class="h-2 flex-1 overflow-hidden rounded bg-muted">
														<div
															class="h-full rounded bg-primary/80"
															style="width: {(p.dps / maxDps) * 100}%"
														></div>
													</div>
													<span class="w-12 text-right tabular-nums">{fmtRate(p.dps)}</span>
												</div>
											</td>
											<td class="px-3 py-2 text-right tabular-nums">
												{fmtNum(p.damage)}
												<div class="text-[10px] text-muted-foreground">
													{pct(p.damage, totalDmg)}%
												</div>
											</td>
											<td class="px-3 py-2">
												<div class="flex items-center gap-2">
													<div class="h-2 flex-1 overflow-hidden rounded bg-muted">
														<div
															class="h-full rounded bg-emerald-500/80"
															style="width: {(p.hps / maxHps) * 100}%"
														></div>
													</div>
													<span class="w-10 text-right tabular-nums">{fmtRate(p.hps)}</span>
												</div>
											</td>
											<td class="px-3 py-2 text-right text-muted-foreground tabular-nums"
												>{p.overheal ? fmtNum(p.overheal) : ''}</td
											>
											<td class="px-3 py-2 text-right text-muted-foreground tabular-nums"
												>{p.shielding ? fmtNum(p.shielding) : ''}</td
											>
											<td class="px-3 py-2 text-right tabular-nums">
												{fmtNum(p.damageTaken)}
												<div class="mt-1 h-1 overflow-hidden rounded bg-muted">
													<div
														class="h-full bg-red-500/70"
														style="width: {(p.damageTaken / maxTaken) * 100}%"
													></div>
												</div>
											</td>
											<td
												class="px-3 py-2 text-right tabular-nums {p.environmentalTaken
													? 'text-orange-300'
													: 'text-muted-foreground'}"
												>{p.environmentalTaken ? fmtNum(p.environmentalTaken) : ''}</td
											>
											<td class="px-3 py-2 text-right text-red-300 tabular-nums">
												{#if p.deaths == null}<Locked compact />{:else}{p.deaths || ''}{/if}
											</td>
											<td class="px-3 py-2 text-right tabular-nums">{p.interrupts || ''}</td>
											<td class="px-3 py-2 text-right text-muted-foreground tabular-nums"
												>{p.critPct}%</td
											>
											<td
												class="px-3 py-2 text-right text-muted-foreground tabular-nums"
												title={ACTIVE_QUIP(active)}>{active}%</td
											>
										</tr>
									{/each}
								</tbody>
								<tfoot class="text-xs text-muted-foreground">
									<tr class="border-t border-border/50">
										<td class="px-3 py-2">Party</td>
										<td class="px-3 py-2">{fmtRate(totalDmg / (run.durationMs / 1000))} DPS</td>
										<td class="px-3 py-2 text-right tabular-nums">{fmtNum(totalDmg)}</td>
										<td class="px-3 py-2">{fmtRate(totalHeal / (run.durationMs / 1000))} HPS</td>
										<td colspan="8"></td>
									</tr>
								</tfoot>
							</table>
						</div>
						<p class="text-xs text-muted-foreground">
							DPS/HPS over the whole run, trash and corpse runs included — standing around dead
							counts against you, as it should. “Active” = time spent actually pressing buttons.
						</p>
					{:else}
						<p class="text-sm text-muted-foreground italic">
							No numbers. The meter died before anyone else did.
						</p>
					{/if}
				</Tabs.Content>

				<!-- BOSSES -->
				<Tabs.Content value="bosses" class="mt-4 space-y-3">
					{#if !bossSegs.length}
						<div class="wow-frame rounded-lg p-6 text-sm text-muted-foreground">
							No boss fights detected. Either they only killed trash, or the game didn't log the
							encounters. Trash is still murder, technically.
						</div>
					{/if}
					{#each bossSegs as s, i (i)}
						{@const segDur = Math.max(1, (s.endMs - s.startMs) / 1000)}
						{@const sp = [...s.players].sort((a, b) => b.damage - a.damage)}
						{@const segMax = Math.max(1, ...sp.map((x) => x.damage))}
						<section class="wow-frame rounded-lg p-4">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="font-display text-lg font-semibold text-primary">{s.name}</h3>
								<span
									class="rounded border px-2 py-0.5 text-xs font-semibold {s.result === 'kill'
										? TONE.good
										: s.result === 'wipe'
											? TONE.bad
											: TONE.mid}"
								>
									{s.result === 'kill'
										? 'Killed'
										: s.result === 'wipe'
											? 'Wiped. Spectacularly.'
											: 'Unfinished'}
								</span>
								<span class="ml-auto text-sm text-muted-foreground tabular-nums">
									{fmtDuration(s.endMs - s.startMs)} · at {fmtDuration(s.startMs)}
								</span>
							</div>
							<div class="mt-3 space-y-1.5">
								{#each sp as p (p.slug)}
									<div class="grid grid-cols-[9rem_1fr_6rem_5rem] items-center gap-3 text-sm">
										<span
											class="truncate font-semibold"
											style="color: {classColor(classes[p.slug] ?? undefined)}"
											>{names[p.slug] ?? p.slug}</span
										>
										<div class="h-2 overflow-hidden rounded bg-muted">
											<div
												class="h-full rounded bg-primary/80"
												style="width: {(p.damage / segMax) * 100}%"
											></div>
										</div>
										<span class="text-right tabular-nums">{fmtRate(p.damage / segDur)} DPS</span>
										<span class="text-right text-xs text-muted-foreground tabular-nums"
											>{p.healing ? `${fmtRate(p.healing / segDur)} HPS` : ''}</span
										>
									</div>
								{/each}
							</div>
						</section>
					{/each}
				</Tabs.Content>

				<!-- DEATHS -->
				<Tabs.Content value="deaths" class="mt-4 space-y-3">
					{#if !run.deaths?.length}
						<div class="wow-frame rounded-lg p-6 text-sm text-muted-foreground">
							Zero deaths. Either they're good, or the healer was carrying hard. Our money's on the
							healer.
						</div>
					{/if}
					{#each run.deaths ?? [] as d, i (i)}
						<section class="wow-frame rounded-lg p-4">
							<div class="flex flex-wrap items-baseline gap-2">
								<span class="text-lg">⚰️</span>
								<span
									class="font-semibold"
									style="color: {classColor(classes[d.slug] ?? undefined)}"
									>{names[d.slug] ?? d.slug}</span
								>
								<span class="text-sm text-muted-foreground">
									{#if d.killer}murdered by <b class="text-foreground">{d.killer}</b>{:else}killed
										by gravity, lava or their own stupidity{/if}
									{#if d.killingBlow}with <b class="text-red-300">{d.killingBlow}</b>{/if}
								</span>
								<span class="ml-auto text-sm text-muted-foreground tabular-nums"
									>at {fmtDuration(d.atMs)}</span
								>
							</div>
							{#if d.recap.length}
								<div class="mt-3 space-y-1 text-xs">
									<div class="text-muted-foreground">Last moments (newest at the bottom):</div>
									{#each d.recap as r, j (j)}
										<div
											class="grid grid-cols-[3.5rem_1fr_9rem_6rem] items-center gap-2 tabular-nums"
										>
											<span class="text-muted-foreground">{(r.atMs / 1000).toFixed(1)}s</span>
											<span class="truncate">
												{r.spell ?? 'Melee'}
												{#if r.source}<span class="text-muted-foreground">· {r.source}</span>{/if}
											</span>
											<span
												class="text-right font-semibold {r.amount < 0
													? 'text-red-300'
													: 'text-emerald-300'}"
											>
												{r.amount > 0 ? '+' : ''}{fmtNum(r.amount)}{r.overkill
													? ` (${fmtNum(r.overkill)} overkill)`
													: ''}
											</span>
											<span>
												{#if r.hp != null && r.maxHp}
													<span
														class="block h-1.5 overflow-hidden rounded bg-muted"
														title="{fmtNum(r.hp)} / {fmtNum(r.maxHp)} HP"
													>
														<span
															class="block h-full bg-emerald-500/80"
															style="width: {pct(r.hp, r.maxHp)}%"
														></span>
													</span>
												{/if}
											</span>
										</div>
									{/each}
								</div>
							{/if}
						</section>
					{/each}
				</Tabs.Content>

				<!-- LOOT -->
				<Tabs.Content value="loot" class="mt-4 space-y-4">
					{#if !loot.length}
						<div class="wow-frame rounded-lg p-6 text-sm text-muted-foreground">
							No loot recorded. Either nobody had <code class="text-primary">/chatlog</code> on, or this
							party walked past every corpse without looting. Animals.
						</div>
					{:else}
						<div class="flex flex-wrap gap-2">
							{#each lootBy as g (g.slug ?? g.name)}
								<div class="wow-frame rounded-lg px-3 py-2 text-sm">
									<span
										class="font-semibold"
										style="color: {classColor(classes[g.slug ?? ''] ?? undefined)}">{g.name}</span
									>
									<span class="ml-1 text-muted-foreground"
										>{g.items} item{g.items === 1 ? '' : 's'}</span
									>
									{#if g.best >= 0}<span class="ml-1 text-xs" style="color: {lootColor(g.best)}"
											>· best: {QUALITY_NAME[g.best] ?? '?'}</span
										>{/if}
								</div>
							{/each}
						</div>
						<div class="wow-frame overflow-hidden rounded-lg">
							<table class="w-full text-sm">
								<thead class="text-xs text-muted-foreground">
									<tr class="border-b border-border/50">
										<th class="w-20 px-3 py-2 text-left">When</th>
										<th class="px-3 py-2 text-left">Item</th>
										<th class="px-3 py-2 text-left">Grabbed by</th>
									</tr>
								</thead>
								<tbody>
									{#each loot as l, i (i)}
										<tr class="border-b border-border/30 last:border-0">
											<td class="px-3 py-1.5 text-muted-foreground tabular-nums"
												>{fmtDuration(Math.max(0, l.atMs))}</td
											>
											<td class="px-3 py-1.5">
												<span style="color: {lootColor(l.quality)}">[{l.item}]</span>
												{#if l.count > 1}<span class="text-muted-foreground"> ×{l.count}</span>{/if}
											</td>
											<td class="px-3 py-1.5">
												{#if l.slug && tracked.has(l.slug)}
													<a
														href="/c/{l.slug}"
														class="hover:underline"
														style="color: {classColor(classes[l.slug] ?? undefined)}"
														>{names[l.slug] ?? l.looter}</a
													>
												{:else}
													<span style="color: {classColor(classes[l.slug ?? ''] ?? undefined)}"
														>{l.slug ? (names[l.slug] ?? l.looter) : l.looter}</span
													>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<p class="text-xs text-muted-foreground">
							From the uploader's <code>/chatlog</code>. Need/greed rolls aren't tracked yet — only
							who ended up with it.
						</p>
					{/if}
				</Tabs.Content>

				<!-- TIMELINE -->
				<Tabs.Content value="timeline" class="mt-4">
					{#if run.timeline}
						<section class="wow-frame rounded-lg p-4">
							<RunTimeline
								timeline={run.timeline}
								segments={run.segments ?? []}
								{names}
								{classes}
							/>
						</section>
					{/if}
				</Tabs.Content>

				<!-- SPELLS -->
				<Tabs.Content value="spells" class="mt-4 space-y-3">
					<div class="flex flex-wrap gap-1.5">
						{#each players as p (p.slug)}
							<button
								class="rounded-md border px-2.5 py-1 text-sm {spellPlayer?.slug === p.slug
									? 'border-primary bg-primary/15'
									: 'border-border hover:border-primary/60'}"
								style="color: {classColor(p.classId ?? undefined)}"
								onclick={() => (spellsFor = p.slug)}>{p.name}</button
							>
						{/each}
					</div>
					{#if spellPlayer}
						<div class="grid gap-4 lg:grid-cols-2">
							{#each [['Damage', spellPlayer.topDamage, spellPlayer.damage], ['Healing', spellPlayer.topHealing, spellPlayer.healing]] as const as [label, list, total] (label)}
								<section class="wow-frame rounded-lg p-4">
									<h3 class="mb-2 font-display font-semibold text-primary">{label}</h3>
									{#if !list.length}
										<p class="text-sm text-muted-foreground italic">
											{label === 'Healing'
												? 'Healed nobody. Not even themselves. Bold.'
												: 'Did no damage. A true pacifist.'}
										</p>
									{/if}
									{#each list as s (`${s.id}-${s.pet}`)}
										<div class="grid grid-cols-[1fr_5rem_3.5rem] items-center gap-2 py-1 text-sm">
											<div class="min-w-0">
												<div class="truncate">
													{s.name}{#if s.pet}<span class="ml-1 text-xs text-muted-foreground"
															>(pet)</span
														>{/if}
												</div>
												<div class="h-1 overflow-hidden rounded bg-muted">
													<div
														class="h-full {label === 'Healing'
															? 'bg-emerald-500/80'
															: 'bg-primary/80'}"
														style="width: {pct(s.amount, total)}%"
													></div>
												</div>
											</div>
											<span class="text-right tabular-nums">{fmtNum(s.amount)}</span>
											<span class="text-right text-xs text-muted-foreground tabular-nums"
												>{pct(s.amount, total)}%</span
											>
										</div>
										<div class="-mt-0.5 mb-1 text-[10px] text-muted-foreground">
											{s.hits} hit{s.hits === 1 ? '' : 's'} · {s.hits
												? Math.round((s.crits / s.hits) * 100)
												: 0}% crit
										</div>
									{/each}
								</section>
							{/each}
						</div>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		{/if}
	{/if}
</div>
