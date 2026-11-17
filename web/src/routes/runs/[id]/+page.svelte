<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import Tip from '#lib/components/wow/Tip.svelte';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import SortHead from '#lib/components/table/SortHead.svelte';
	import { TableSort } from '#lib/sort.svelte.js';
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
	import CombatLogPanel from '#lib/components/wow/CombatLogPanel.svelte';
	import RunTimeline from '#lib/components/wow/RunTimeline.svelte';
	import { classColor, iconFallback } from '#lib/wow.js';
	import RunReplay from '#lib/components/wow/RunReplay.svelte';
	import ItemLink from '#lib/components/wow/ItemLink.svelte';
	import { ACTIVE_QUIP, END_REASON, deathQuip, durationQuip, fmtDuration, fmtMoney, fmtNum, fmtRate, lootColor, QUALITY_NAME, RECORD_KINDS, RECORD_LABEL, resultBadge } from '#lib/runs.js';
	import { fmtWhen } from '#lib/datetime.svelte.js';

	const id = $derived(page.params.id ?? '');
	const q = useQuery(api.runs.get, () => ({ id }));
	const run = $derived(q.data && !q.data.locked ? q.data.run : null);

	// navade partyja (Companion 0.1.15+): napoji, friendly fire, CC breaks, mana
	const habits = $derived.by(() => {
		const ps = run?.players ?? [];
		const top = (f: (p: (typeof ps)[number]) => number) =>
			[...ps].filter((p) => f(p) > 0).sort((a, b) => f(b) - f(a))[0];
		const out: { title: string; value: string; slug: string; note: string }[] = [];
		const pot = top((p) => p.potions ?? 0);
		if (pot)
			out.push({
				title: 'Potion addict',
				value: String(pot.potions),
				slug: pot.slug,
				note: `potions & healthstones, ${fmtNum(pot.potionHealing ?? 0)} healed`
			});
		const ff = top((p) => p.friendlyFire ?? 0);
		if (ff)
			out.push({
				title: 'Friendly fire',
				value: fmtNum(ff.friendlyFire ?? 0),
				slug: ff.slug,
				note: 'damage to the own party. Oops.'
			});
		const cc = top((p) => p.ccBreaks ?? 0);
		if (cc)
			out.push({
				title: 'Sheep breaker',
				value: String(cc.ccBreaks),
				slug: cc.slug,
				note: 'crowd control broken by hitting it'
			});
		const mana = (p: (typeof ps)[number]) =>
			(p.power ?? []).find((x) => x.kind === 'Mana')?.amount ?? 0;
		const mp = top(mana);
		if (mp)
			out.push({
				title: 'Mana sponge',
				value: fmtNum(mana(mp)),
				slug: mp.slug,
				note: 'mana received'
			});
		return out;
	});
	// škoda po urokih za ves party (iz top urokov vsakega igralca)
	const spellBoard = $derived(
		(run?.players ?? [])
			.flatMap((p) =>
				(p.topDamage ?? []).map((sp) => ({
					key: `${p.slug}:${sp.id}:${sp.pet}`,
					name: sp.name + (sp.pet ? ' (pet)' : ''),
					slug: p.slug,
					amount: sp.amount
				}))
			)
			.sort((a, b) => b.amount - a.amount)
			.slice(0, 12)
	);
	const itemDetail = $derived(new Map((run?.itemDetails ?? []).map((d) => [d.itemId, d])));
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
	// boss segmenti z indeksom v run.segments (razčlenitev se naloži po tem indeksu)
	const bossSegs = $derived(
		(run?.segments ?? []).map((s, idx) => ({ ...s, idx })).filter((s) => s.kind === 'boss')
	);
	const fightMs = $derived(run?.combatMs || run?.durationMs || 1);
	const totalDeaths = $derived(run?.totalDeaths ?? null);

	// ?tab=meter|bosses|deaths|timeline|spells → povezava naravnost na zavihek
	const TABS = ['meter', 'bosses', 'deaths', 'loot', 'timeline', 'replay', 'spells'];
	// stare povezave: ?tab=numbers je zdaj v Overview, ?tab=timeline pri runu z replayem je pod replayem
	const ALIAS: Record<string, string> = { numbers: 'meter' };
	/** izbrani zavihek (null = iz URL ali privzeti) */
	let tabSel = $state<string | null>(null);

	function initialTab(a: { details: boolean; deaths: boolean; loot: boolean }) {
		let t = page.url.searchParams.get('tab') ?? '';
		t = ALIAS[t] ?? t;
		if (t === 'timeline' && run?.hasReplay) t = 'replay';
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

	// Bosses: odprta razčlenitev igralca (`${segment index}:${slug}`); naloži se šele ob kliku (DB I/O)
	let openBoss = $state<string | null>(null);
	const bossQ = useQuery(api.runs.bossDetail, () =>
		openBoss ? { id: page.params.id ?? '', index: Number(openBoss.split(':')[0]) } : 'skip'
	);
	type SegP = NonNullable<typeof run>['segments'] extends (infer S)[] | null
		? S extends { players: (infer P)[] }
			? P
			: never
		: never;
	/** razčlenitev igralca: iz ločenega dokumenta ali (starejši runi) kar iz segmenta */
	const dp = (p: SegP) => bossQ.data?.find((x) => x.slug === p.slug) ?? p;
	// oprema ob zadnjem pullu (COMBATANT_INFO) + ikone iz cachea
	const gearQ = useQuery(api.runs.gear, () =>
		openBoss
			? { id: page.params.id ?? '', slug: openBoss.slice(openBoss.indexOf(':') + 1) }
			: 'skip'
	);
	const iconOf = $derived(new Map((gearQ.data ?? []).map((g) => [g.itemId, g.url] as const)));
	const itemOf = $derived(new Map((gearQ.data ?? []).map((g) => [g.itemId, g] as const)));
	const gearOf = (slug: string) => players.find((x) => x.slug === slug)?.gear ?? [];

	// need/greed rolli: po predmetih + kocke po igralcih (srečnež, preklete kocke)
	const rolls = $derived(run?.rolls ?? []);
	const dice = $derived.by(() => {
		const m = new Map<
			string,
			{ slug: string; name: string; sum: number; n: number; wins: number; needs: number }
		>();
		for (const r of rolls) {
			for (const e of r.entries) {
				const d = m.get(e.slug) ?? {
					slug: e.slug,
					name: names[e.slug] ?? e.name,
					sum: 0,
					n: 0,
					wins: 0,
					needs: 0
				};
				if (e.roll !== null) {
					d.sum += e.roll;
					d.n += 1;
				}
				if (e.choice === 'need') d.needs += 1;
				if (r.winner === e.slug) d.wins += 1;
				m.set(e.slug, d);
			}
		}
		return [...m.values()].filter((d) => d.n > 0).sort((a, b) => b.sum / b.n - a.sum / a.n);
	});
	const sortedEntries = (r: (typeof rolls)[number]) =>
		[...r.entries].sort((a, b) => (b.roll ?? -1) - (a.roll ?? -1));
	const CHOICE = { need: 'Need', greed: 'Greed', pass: 'Pass' } as const;

	// Big Numbers: največji dogodek vsake vrste (zmagovalec runa) + tabela po igralcih
	const records = $derived(
		players.flatMap((p) => (p.records ?? []).map((r) => ({ ...r, slug: p.slug })))
	);
	const bestRecords = $derived(
		RECORD_KINDS.map((kind) => ({
			kind,
			best: records
				.filter((r) => r.kind === kind)
				.reduce<(typeof records)[number] | null>(
					(b, r) => (!b || r.amount > b.amount ? r : b),
					null
				)
		})).filter((x) => x.best)
	);
	const recordOf = (slug: string, kind: string) =>
		records.find((r) => r.slug === slug && r.kind === kind) ?? null;

	// ---- sortiranje tabel (klik na glavo stolpca)
	type P = (typeof players)[number];
	const meterSort = new TableSort<
		| 'hero'
		| 'dps'
		| 'damage'
		| 'hps'
		| 'overheal'
		| 'shields'
		| 'taken'
		| 'env'
		| 'deaths'
		| 'kicks'
		| 'crit'
		| 'active'
	>('damage');
	const meterRows = $derived(
		meterSort.apply(players, {
			hero: (p: P) => p.name,
			dps: (p: P) => p.dps,
			damage: (p: P) => p.damage,
			hps: (p: P) => p.hps,
			overheal: (p: P) => p.overheal,
			shields: (p: P) => p.shielding,
			taken: (p: P) => p.damageTaken,
			env: (p: P) => p.environmentalTaken,
			deaths: (p: P) => p.deaths,
			kicks: (p: P) => p.interrupts,
			crit: (p: P) => p.critPct,
			active: (p: P) => p.activeMs
		})
	);
	const recordSort = new TableSort<string>();
	const recordRows = $derived(
		recordSort.apply(players, {
			hero: (p: P) => p.name,
			...Object.fromEntries(
				RECORD_KINDS.map((k) => [k, (p: P) => recordOf(p.slug, k)?.amount ?? null])
			)
		})
	);
	type SpellRow = {
		name: string;
		amount: number;
		casts?: number;
		hits: number;
		crits: number;
		max?: number | null;
		overheal?: number | null;
	};
	const spellSort = new TableSort<
		'name' | 'amount' | 'casts' | 'hits' | 'crit' | 'avg' | 'max' | 'overheal'
	>('amount');
	const sortSpells = <T extends SpellRow>(list: T[]) =>
		spellSort.apply(list, {
			name: (x) => x.name,
			amount: (x) => x.amount,
			casts: (x) => x.casts,
			hits: (x) => x.hits,
			crit: (x) => (x.hits ? x.crits / x.hits : null),
			avg: (x) => (x.hits ? x.amount / x.hits : null),
			max: (x) => x.max,
			overheal: (x) => (x.overheal ? x.overheal / Math.max(1, x.amount + x.overheal) : null)
		});
	const rollSort = new TableSort<'when' | 'item' | 'top'>('when', 'asc');
	const rollRows = $derived(
		rollSort.apply(rolls, {
			when: (r) => r.atMs,
			item: (r) => r.item,
			top: (r) => Math.max(-1, ...r.entries.map((e) => e.roll ?? -1))
		})
	);
	const lootSort = new TableSort<'when' | 'item' | 'quality' | 'who'>('when', 'asc');
	const lootRows = $derived(
		lootSort.apply(loot, {
			when: (l) => l.atMs,
			item: (l) => l.item,
			quality: (l) => l.quality,
			who: (l) => (l.slug ? (names[l.slug] ?? l.looter) : l.looter)
		})
	);

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
		<Card.Root class="p-10 text-center">
			<p class="text-5xl">👻</p>
			<p class="mt-2 font-display text-xl text-primary">This run doesn't exist</p>
			<p class="text-sm text-muted-foreground">
				Either it never happened or someone deleted the evidence. We don't judge. Much.
			</p>
		</Card.Root>
	{:else}
		<Tabs.Root
			bind:value={() => tabSel ?? initialTab(run.access), (v) => (tabSel = v)}
			class="gap-6"
		>
			<!-- meni runa: na vrhu, ostane pod glavnim menijem med drsenjem -->
			{#if run.access.details || run.access.deaths || run.access.loot}
				<div class="sticky top-16 z-20 -mx-4 bg-background/85 px-4 py-2 backdrop-blur">
					<Tabs.List class="flex-wrap">
						<Tabs.Trigger value="meter" disabled={!run.access.details}>Overview</Tabs.Trigger>
						<Tabs.Trigger value="bosses" disabled={!run.access.details}>Bosses</Tabs.Trigger>
						<Tabs.Trigger value="deaths" disabled={!run.access.deaths}>Autopsies</Tabs.Trigger>
						<Tabs.Trigger value="loot" disabled={!run.access.loot}
							>Loot{#if loot.length}&nbsp;<span class="text-xs text-muted-foreground"
									>({loot.length})</span
								>{/if}</Tabs.Trigger
						>
						{#if !run.hasReplay}<Tabs.Trigger value="timeline" disabled={!run.access.details}
								>Timeline</Tabs.Trigger
							>{/if}
						{#if run.hasReplay}<Tabs.Trigger value="replay">Replay</Tabs.Trigger>{/if}
						<Tabs.Trigger value="spells" disabled={!run.access.details}>Combat Log</Tabs.Trigger>
					</Tabs.List>
				</div>
			{/if}

			<!-- HEADER: polna glava na Overview, drugje ena vrstica (več prostora za vsebino zavihka) -->
			{#if (tabSel ?? initialTab(run.access)) === 'meter' || (!run.access.details && !run.access.deaths && !run.access.loot)}
				<Card.Root class="space-y-4 p-5">
					<div class="flex flex-wrap items-start gap-4">
						<div class="min-w-0 flex-1 space-y-1">
							<div class="flex flex-wrap items-center gap-2">
								<h1 class="page-title">{run.zone}</h1>
								{#if badge}<span
										class="rounded border px-2 py-0.5 text-sm font-semibold {TONE[badge.tone]}"
										>{badge.text}</span
									>{/if}
								{#if run.result.wipes}
									<span
										class="rounded border border-destructive/40 px-2 py-0.5 text-sm text-red-300"
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
							{#if run.combatMs}
								<Tip
									as="div"
									class="w-fit cursor-help text-xs text-muted-foreground"
									text="DPS and HPS use this time, like Details!"
								>
									{fmtDuration(run.combatMs)} actually fighting
								</Tip>
							{/if}
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
						<Tip
							as="div"
							class="rounded-md border border-border/50 bg-background/30 p-3"
							text={run.leader ? null : "The combat log doesn't record the group leader."}
						>
							<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
								<Crown class="size-3.5" /> Party leader
							</div>
							<div class="font-semibold">{run.leader ?? 'Unknown'}</div>
							{#if !run.leader}<div class="text-xs text-muted-foreground">
									The combat log refuses to name names. Coming with the addon.
								</div>{/if}
						</Tip>
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
								<Tip
									class="rounded-md border border-dashed border-border/60 px-2.5 py-1 text-sm text-muted-foreground"
									text="Not tracked on the portal. A tourist.">{p.name}</Tip
								>
							{/if}
						{/each}
					</div>
				</Card.Root>
			{:else}
				<Card.Root class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
					<h1 class="font-display text-xl font-bold text-primary">{run.zone}</h1>
					{#if badge}<span
							class="rounded border px-2 py-0.5 text-xs font-semibold {TONE[badge.tone]}"
							>{badge.text}</span
						>{/if}
					<span class="text-sm text-muted-foreground">{fmtWhen(run.startedAt)}</span>
					<span class="flex flex-wrap gap-x-2 text-sm">
						{#each run.party as p (p.slug)}<span style="color: {classColor(p.classId ?? undefined)}"
								>{p.name}</span
							>{/each}
					</span>
					<span class="ml-auto font-display text-xl font-semibold tabular-nums"
						>{fmtDuration(run.durationMs)}</span
					>
				</Card.Root>
			{/if}

			{#if !run.access.details && !run.access.deaths && !run.access.loot}
				<Locked what="the meter, the bosses and the autopsy reports" />
			{:else}
				<!-- METER -->
				<Tabs.Content value="meter" class="mt-4 space-y-4">
					<!-- AWARDS (samo na Overview) -->
					{#if run.awards?.length || run.failAwards?.length}
						<section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{#each [...(run.awards ?? []), ...(run.failAwards ?? [])] as a (a.key)}
								<Card.Root class="p-4">
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
								</Card.Root>
							{/each}
						</section>
					{/if}

					{#if players.length}
						<Card.Root class="overflow-x-auto">
							<Table.Root class="w-full min-w-[760px] text-sm">
								<Table.Header class="text-xs text-muted-foreground">
									<Table.Row class="border-b border-border/50">
										<SortHead sort={meterSort} key="hero" first="asc" class="px-3">Hero</SortHead>
										<SortHead sort={meterSort} key="dps" class="w-[22%] px-3">DPS</SortHead>
										<SortHead sort={meterSort} key="damage" align="right" class="px-3"
											>Damage</SortHead
										>
										<SortHead sort={meterSort} key="hps" class="w-[16%] px-3">HPS</SortHead>
										<SortHead
											sort={meterSort}
											key="overheal"
											align="right"
											class="px-3"
											title="Healing that landed on full health bars">Overheal</SortHead
										>
										<SortHead sort={meterSort} key="shields" align="right" class="px-3"
											>Shields</SortHead
										>
										<SortHead sort={meterSort} key="taken" align="right" class="px-3"
											>Taken</SortHead
										>
										<SortHead
											sort={meterSort}
											key="env"
											align="right"
											class="px-3"
											title="Lava, fire, falling, drowning – self-inflicted stupidity"
											>Env.</SortHead
										>
										<SortHead
											sort={meterSort}
											key="deaths"
											align="right"
											class="px-3"
											title="Deaths">☠<span class="sr-only">Deaths</span></SortHead
										>
										<SortHead
											sort={meterSort}
											key="kicks"
											align="right"
											class="px-3"
											title="Interrupts">Kicks</SortHead
										>
										<SortHead sort={meterSort} key="crit" align="right" class="px-3">Crit</SortHead>
										<SortHead sort={meterSort} key="active" align="right" class="px-3"
											>Active</SortHead
										>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each meterRows as p (p.slug)}
										{@const active = pct(p.activeMs, run.durationMs)}
										<Table.Row class="border-b border-border/30 last:border-0">
											<Table.Cell class="px-3 py-2">
												<span
													class="font-semibold whitespace-nowrap"
													style="color: {classColor(p.classId ?? undefined)}">{p.name}</span
												>
												{#if p.recorder}<Tip
														class="ml-1 text-[10px] text-muted-foreground"
														text="Uploaded this run">📣</Tip
													>{/if}
											</Table.Cell>
											<Table.Cell class="px-3 py-2">
												<div class="flex items-center gap-2">
													<div class="h-2 flex-1 overflow-hidden rounded bg-muted">
														<div
															class="h-full rounded bg-primary/80"
															style="width: {(p.dps / maxDps) * 100}%"
														></div>
													</div>
													<span class="w-12 text-right tabular-nums">{fmtRate(p.dps)}</span>
												</div>
											</Table.Cell>
											<Table.Cell class="px-3 py-2 text-right tabular-nums">
												{fmtNum(p.damage)}
												<div class="text-[10px] text-muted-foreground">
													{pct(p.damage, totalDmg)}%
												</div>
											</Table.Cell>
											<Table.Cell class="px-3 py-2">
												<div class="flex items-center gap-2">
													<div class="h-2 flex-1 overflow-hidden rounded bg-muted">
														<div
															class="h-full rounded bg-emerald-500/80"
															style="width: {(p.hps / maxHps) * 100}%"
														></div>
													</div>
													<span class="w-10 text-right tabular-nums">{fmtRate(p.hps)}</span>
												</div>
											</Table.Cell>
											<Table.Cell class="px-3 py-2 text-right text-muted-foreground tabular-nums"
												>{p.overheal ? fmtNum(p.overheal) : ''}</Table.Cell
											>
											<Table.Cell class="px-3 py-2 text-right text-muted-foreground tabular-nums"
												>{p.shielding ? fmtNum(p.shielding) : ''}</Table.Cell
											>
											<Table.Cell class="px-3 py-2 text-right tabular-nums">
												{fmtNum(p.damageTaken)}
												<div class="mt-1 h-1 overflow-hidden rounded bg-muted">
													<div
														class="h-full bg-red-500/70"
														style="width: {(p.damageTaken / maxTaken) * 100}%"
													></div>
												</div>
											</Table.Cell>
											<Table.Cell
												class="px-3 py-2 text-right tabular-nums {p.environmentalTaken
													? 'text-orange-300'
													: 'text-muted-foreground'}"
												>{p.environmentalTaken ? fmtNum(p.environmentalTaken) : ''}</Table.Cell
											>
											<Table.Cell class="px-3 py-2 text-right text-red-300 tabular-nums">
												{#if p.deaths == null}<Locked compact />{:else}{p.deaths || ''}{/if}
											</Table.Cell>
											<Table.Cell class="px-3 py-2 text-right tabular-nums"
												>{p.interrupts || ''}</Table.Cell
											>
											<Table.Cell class="px-3 py-2 text-right text-muted-foreground tabular-nums"
												>{p.critPct}%</Table.Cell
											>
											<Table.Cell class="px-3 py-2 text-right text-muted-foreground tabular-nums"
												><Tip text={ACTIVE_QUIP(active)}>{active}%</Tip></Table.Cell
											>
										</Table.Row>
									{/each}
								</Table.Body>
								<Table.Footer class="text-xs text-muted-foreground">
									<Table.Row class="border-t border-border/50">
										<Table.Cell class="px-3 py-2">Party</Table.Cell>
										<Table.Cell class="px-3 py-2"
											>{fmtRate(totalDmg / (fightMs / 1000))} DPS</Table.Cell
										>
										<Table.Cell class="px-3 py-2 text-right tabular-nums"
											>{fmtNum(totalDmg)}</Table.Cell
										>
										<Table.Cell class="px-3 py-2"
											>{fmtRate(totalHeal / (fightMs / 1000))} HPS</Table.Cell
										>
										<Table.Cell colspan={8}></Table.Cell>
									</Table.Row>
								</Table.Footer>
							</Table.Root>
						</Card.Root>
						<p class="text-xs text-muted-foreground">
							{#if run.combatMs}
								DPS/HPS over the {fmtDuration(run.combatMs)} the party actually fought (like Details!
								“effective time”) – walking, AFK and corpse runs don't count.
							{:else}
								DPS/HPS over the whole run (recorded before Companion 0.1.15), trash and corpse runs
								included.
							{/if}
							“Active” = time spent actually pressing buttons.
						</p>
					{:else}
						<p class="text-sm text-muted-foreground italic">
							No numbers. The meter died before anyone else did.
						</p>
					{/if}
					<!-- navade, rekordi, škoda po urokih (prej zavihek Big Numbers) -->
					{#if habits.length || spellBoard.length || (run.enemyHeals ?? []).length}
						<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							{#each habits as h (h.title)}
								<Card.Root class="p-4">
									<div class="eyebrow">{h.title}</div>
									<div class="mt-1 text-2xl font-bold text-primary tabular-nums">{h.value}</div>
									<div class="mt-1 text-sm">
										<span
											class="font-semibold"
											style="color: {classColor(classes[h.slug] ?? undefined)}"
											>{names[h.slug] ?? h.slug}</span
										>
										<span class="text-muted-foreground">· {h.note}</span>
									</div>
								</Card.Root>
							{/each}
						</div>
						<div class="grid gap-3 lg:grid-cols-2">
							{#if spellBoard.length}
								<Card.Root class="p-4">
									<h3 class="card-title">Damage by spell (whole party)</h3>
									<ul class="mt-2 space-y-1 text-sm">
										{#each spellBoard as sp (sp.key)}
											<li class="flex items-baseline justify-between gap-2">
												<span class="truncate"
													>{sp.name}
													<span
														class="text-xs"
														style="color: {classColor(classes[sp.slug] ?? undefined)}"
														>{names[sp.slug] ?? sp.slug}</span
													></span
												>
												<span class="tabular-nums">{fmtNum(sp.amount)}</span>
											</li>
										{/each}
									</ul>
								</Card.Root>
							{/if}
							{#if (run.enemyHeals ?? []).length}
								<Card.Root class="p-4">
									<h3 class="card-title">Mobs that healed themselves</h3>
									<p class="section-lead">
										Kill the healer first. Every time. Apparently not this time.
									</p>
									<ul class="mt-2 space-y-1 text-sm">
										{#each run.enemyHeals ?? [] as e (e.name)}
											<li class="flex justify-between gap-2">
												<span>{e.name}</span><span class="text-[#1eff00] tabular-nums"
													>+{fmtNum(e.amount)}</span
												>
											</li>
										{/each}
									</ul>
								</Card.Root>
							{/if}
						</div>
					{/if}
					{#if !records.length}
						<Card.Root class="p-6 text-sm text-muted-foreground">
							No big numbers on file. This run was recorded by an older Companion — update the app
							and the next one will name and shame the biggest crit.
						</Card.Root>
					{:else}
						<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{#each bestRecords as { kind, best } (kind)}
								{#if best}
									<Card.Root class="p-4">
										<div class="eyebrow">
											{RECORD_LABEL[kind].title}
										</div>
										<div class="mt-1 text-3xl font-bold text-primary tabular-nums">
											{fmtNum(best.amount)}
										</div>
										<div class="mt-1 text-sm">
											<span
												class="font-semibold"
												style="color: {classColor(classes[best.slug] ?? undefined)}"
												>{names[best.slug] ?? best.slug}</span
											>
											<span class="text-muted-foreground">·</span>
											{best.spell}{#if best.pet}<span class="text-xs text-muted-foreground">
													(pet)</span
												>{/if}
											{#if best.unit}<span class="text-muted-foreground">
													{RECORD_LABEL[kind].prep}</span
												>
												{best.unit}{/if}
										</div>
										<div class="mt-1 text-xs text-muted-foreground italic">
											{RECORD_LABEL[kind].quip} · at {fmtDuration(best.atMs)}
										</div>
									</Card.Root>
								{/if}
							{/each}
						</div>

						<Card.Root class="overflow-x-auto p-4">
							<Table.Root class="w-full text-sm">
								<Table.Header>
									<Table.Row class="text-left text-xs text-muted-foreground">
										<SortHead sort={recordSort} key="hero" first="asc" class="font-normal"
											>Hero</SortHead
										>
										{#each RECORD_KINDS as kind (kind)}
											<SortHead sort={recordSort} key={kind} align="right" class="font-normal"
												>{RECORD_LABEL[kind].title}</SortHead
											>
										{/each}
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each recordRows as p (p.slug)}
										<Table.Row class="border-t border-border">
											<Table.Cell
												class="py-1.5 pr-3 font-semibold"
												style="color: {classColor(p.classId ?? undefined)}">{p.name}</Table.Cell
											>
											{#each RECORD_KINDS as kind (kind)}
												{@const r = recordOf(p.slug, kind)}
												<Table.Cell class="py-1.5 pl-3 text-right tabular-nums">
													<Tip
														as="div"
														text={r
															? `${r.spell}${r.unit ? ` ${RECORD_LABEL[kind].prep} ${r.unit}` : ''} · at ${fmtDuration(r.atMs)}`
															: null}
													>
														{#if r}{fmtNum(r.amount)}
															<span class="block text-xs text-muted-foreground">{r.spell}</span>
														{:else}<span class="text-muted-foreground">—</span>{/if}
													</Tip>
												</Table.Cell>
											{/each}
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</Card.Root>
					{/if}
				</Tabs.Content>

				<!-- BOSSES -->
				<Tabs.Content value="bosses" class="mt-4 space-y-3">
					{#if !bossSegs.length}
						<Card.Root class="p-6 text-sm text-muted-foreground">
							No boss fights detected. Either they only killed trash, or the game didn't log the
							encounters. Trash is still murder, technically.
						</Card.Root>
					{/if}
					{#if bossSegs.length && !bossSegs.some( (s) => s.players.some((p) => p.hasDetail || p.spells?.length) )}
						<p class="text-xs text-muted-foreground">
							No per-player breakdown (spells, buffs, gear, fight graph) for this run – it was
							recorded by a Companion older than 0.1.8. Update the app and the next run has it.
						</p>
					{:else if bossSegs.length}
						<p class="text-xs text-muted-foreground">
							Click a name with ▸ for spells, buffs, gear and the fight graph.
						</p>
					{/if}
					{#each bossSegs as s, i (i)}
						{@const segDur = Math.max(1, (s.endMs - s.startMs) / 1000)}
						{@const sp = [...s.players].sort((a, b) => b.damage - a.damage)}
						{@const segMax = Math.max(1, ...sp.map((x) => x.damage))}
						<Card.Root class="p-4">
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
									{@const k = `${s.idx}:${p.slug}`}
									{@const detail = !!(
										p.hasDetail ||
										p.spells?.length ||
										p.heals?.length ||
										p.casts?.length
									)}
									<button
										class="grid w-full grid-cols-[9rem_1fr_6rem_5rem] items-center gap-3 text-left text-sm {detail
											? 'cursor-pointer rounded hover:bg-muted/30'
											: 'cursor-default'}"
										onclick={() => detail && (openBoss = openBoss === k ? null : k)}
									>
										<span
											class="truncate font-semibold"
											style="color: {classColor(classes[p.slug] ?? undefined)}"
											>{detail ? (openBoss === k ? '▾ ' : '▸ ') : ''}{names[p.slug] ?? p.slug}</span
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
									</button>
									{#if openBoss === k}
										<div
											class="space-y-3 rounded-md border border-border/50 bg-muted/10 p-3 text-xs"
										>
											<div class="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
												{#if p.ilvl}<span>ilvl <b class="text-foreground">{p.ilvl}</b></span>{/if}
												{#if p.activeMs !== undefined}<span
														>active <b class="text-foreground"
															>{Math.round(((p.activeMs ?? 0) / 1000 / segDur) * 100)}%</b
														></span
													>{/if}
												<span>taken <b class="text-foreground">{fmtNum(p.damageTaken)}</b></span>
												{#if p.interrupts}<span
														>interrupts <b class="text-foreground">{p.interrupts}</b></span
													>{/if}
												{#if p.dispels}<span
														>dispels <b class="text-foreground">{p.dispels}</b></span
													>{/if}
												{#if p.deaths}<span class="text-destructive">died {p.deaths}×</span>{/if}
											</div>
											{#if dp(p).combat}
												<div class="text-xs text-muted-foreground">
													Grouped like the game's Combat Log Config.
												</div>
												<CombatLogPanel combat={dp(p).combat!} secs={segDur} />
											{/if}
											{#each [{ title: 'Spells & abilities: damage', list: dp(p).spells ?? [], total: p.damage }, { title: 'Spells & abilities: healing', list: dp(p).heals ?? [], total: p.healing }] as part (part.title)}
												{#if part.list.length}
													<Table.Root class="w-full">
														<Table.Header class="text-muted-foreground">
															<Table.Row class="border-b border-border/40">
																<SortHead sort={spellSort} key="name" first="asc" class="h-8"
																	>{part.title}</SortHead
																>
																<SortHead sort={spellSort} key="amount" align="right" class="h-8"
																	>Amount</SortHead
																>
																<Table.Head class="h-8 text-right">%</Table.Head>
																<SortHead sort={spellSort} key="casts" align="right" class="h-8"
																	>Casts</SortHead
																>
																<SortHead sort={spellSort} key="hits" align="right" class="h-8"
																	>Hits</SortHead
																>
																<SortHead sort={spellSort} key="crit" align="right" class="h-8"
																	>Crit</SortHead
																>
																<SortHead
																	sort={spellSort}
																	key="avg"
																	align="right"
																	class="hidden h-8 sm:table-cell">Avg</SortHead
																>
																<SortHead
																	sort={spellSort}
																	key="max"
																	align="right"
																	class="hidden h-8 sm:table-cell">Min–Max</SortHead
																>
																{#if part.title.endsWith('healing')}<SortHead
																		sort={spellSort}
																		key="overheal"
																		align="right"
																		class="hidden h-8 sm:table-cell">Overheal</SortHead
																	>{/if}
															</Table.Row>
														</Table.Header>
														<Table.Body>
															{#each sortSpells(part.list) as x (x.id + ':' + x.pet)}
																<Table.Row class="border-b border-border/20 last:border-0">
																	<Table.Cell class="py-1"
																		>{x.name}{#if x.pet}<span class="text-muted-foreground">
																				(pet)</span
																			>{/if}</Table.Cell
																	>
																	<Table.Cell class="py-1 text-right tabular-nums"
																		>{fmtNum(x.amount)}</Table.Cell
																	>
																	<Table.Cell class="py-1 text-right tabular-nums"
																		>{part.total
																			? Math.round((x.amount / part.total) * 100)
																			: 0}%</Table.Cell
																	>
																	<Table.Cell class="py-1 text-right tabular-nums"
																		>{x.casts || '—'}</Table.Cell
																	>
																	<Table.Cell class="py-1 text-right tabular-nums"
																		>{x.hits}</Table.Cell
																	>
																	<Table.Cell class="py-1 text-right tabular-nums"
																		>{x.hits
																			? Math.round((x.crits / x.hits) * 100)
																			: 0}%</Table.Cell
																	>
																	<Table.Cell
																		class="hidden py-1 text-right tabular-nums sm:table-cell"
																		>{x.hits
																			? fmtNum(Math.round(x.amount / x.hits))
																			: '—'}</Table.Cell
																	>
																	<Table.Cell
																		class="hidden py-1 text-right tabular-nums sm:table-cell"
																		>{x.max
																			? `${fmtNum(x.min ?? 0)}–${fmtNum(x.max)}`
																			: '—'}</Table.Cell
																	>
																	{#if part.title.endsWith('healing')}<Table.Cell
																			class="hidden py-1 text-right tabular-nums sm:table-cell"
																			>{x.overheal
																				? `${Math.round(((x.overheal ?? 0) / Math.max(1, x.amount + (x.overheal ?? 0))) * 100)}%`
																				: '—'}</Table.Cell
																		>{/if}
																</Table.Row>
															{/each}
														</Table.Body>
													</Table.Root>
												{/if}
											{/each}
											{#if bossQ.data?.some((x) => x.timeline)}
												{@const bt = bossQ.data.filter((x) => x.timeline)}
												<div>
													<div class="mb-1 font-semibold text-muted-foreground">
														The fight, {(bt[0].timeline?.bucketMs ?? 2000) / 1000} s at a time
													</div>
													<RunTimeline
														timeline={{
															bucketMs: bt[0].timeline?.bucketMs ?? 2000,
															players: bt.map((x) => ({
																slug: x.slug,
																damage: x.timeline?.damage ?? [],
																healing: x.timeline?.healing ?? [],
																taken: x.timeline?.taken ?? []
															}))
														}}
														segments={[]}
														{names}
														{classes}
													/>
												</div>
											{/if}
											{#if gearOf(p.slug).length}
												<div>
													<div class="mb-1 font-semibold text-muted-foreground">
														Wearing at the last pull
														<span class="font-normal"
															>· avg ilvl {Math.round(
																gearOf(p.slug).reduce((n, g) => n + g.ilvl, 0) /
																	gearOf(p.slug).length
															)}</span
														>
													</div>
													<div class="flex flex-wrap gap-1">
														{#each gearOf(p.slug) as g, gi (gi)}
															<Tip
																as="div"
																class="relative size-8 overflow-hidden rounded border bg-muted"
																style="border-color: {itemOf.get(g.itemId)?.quality != null
																	? lootColor(itemOf.get(g.itemId)?.quality)
																	: 'var(--border)'}"
																text="{itemOf.get(g.itemId)?.name ??
																	`Item ${g.itemId}`} · ilvl {g.ilvl}"
															>
																{#if iconOf.get(g.itemId)}<img
																		src={iconOf.get(g.itemId)}
																		alt=""
																		class="size-full"
																		loading="lazy"
																		onerror={iconFallback}
																	/>{/if}
																<span
																	class="absolute right-0 bottom-0 bg-background/80 px-0.5 text-[9px] leading-none tabular-nums"
																	>{g.ilvl}</span
																>
															</Tip>
														{/each}
													</div>
												</div>
											{/if}
											<div class="grid gap-3 sm:grid-cols-2">
												{#if dp(p).targets?.length}
													<div>
														<div class="mb-1 font-semibold text-muted-foreground">Targets</div>
														{#each dp(p).targets as t (t.name)}
															<div class="flex justify-between">
																<span class="truncate">{t.name}</span><span class="tabular-nums"
																	>{fmtNum(t.amount)}</span
																>
															</div>
														{/each}
													</div>
												{/if}
												{#each [{ title: 'Auras: beneficial (uptime)', list: dp(p).buffs ?? [] }, { title: 'Auras: hostile, kept on enemies', list: dp(p).debuffs ?? [] }] as au (au.title)}
													{#if au.list.length}
														<div>
															<div class="mb-1 font-semibold text-muted-foreground">{au.title}</div>
															{#each au.list as a (a.id)}
																{@const pct = Math.min(
																	100,
																	Math.round((a.uptimeMs / 1000 / segDur) * 100)
																)}
																<div class="flex items-center gap-2">
																	<span class="w-32 truncate">{a.name}</span>
																	<div class="h-1.5 flex-1 overflow-hidden rounded bg-muted">
																		<div
																			class="h-full rounded bg-primary/70"
																			style="width: {pct}%"
																		></div>
																	</div>
																	<span class="w-9 text-right tabular-nums">{pct}%</span>
																</div>
															{/each}
														</div>
													{/if}
												{/each}
												{#if dp(p).casts?.length}
													<div>
														<div class="mb-1 font-semibold text-muted-foreground">
															Spell Casting: successful casts
														</div>
														{#each dp(p).casts as c (c.id + ':' + c.pet)}
															<div class="flex justify-between">
																<span class="truncate"
																	>{c.name}{#if c.pet}<span class="text-muted-foreground">
																			(pet)</span
																		>{/if}</span
																><span class="tabular-nums">{c.count}</span>
															</div>
														{/each}
													</div>
												{/if}
											</div>
										</div>
									{/if}
								{/each}
							</div>
						</Card.Root>
					{/each}
				</Tabs.Content>

				<!-- DEATHS -->
				<Tabs.Content value="deaths" class="mt-4 space-y-3">
					{#if !run.deaths?.length}
						<Card.Root class="p-6 text-sm text-muted-foreground">
							Zero deaths. Either they're good, or the healer was carrying hard. Our money's on the
							healer.
						</Card.Root>
					{/if}
					{#each run.deaths ?? [] as d, i (i)}
						<Card.Root class="p-4">
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
													<Tip
														class="flex h-1.5 overflow-hidden rounded bg-muted"
														text="{fmtNum(r.hp)} / {fmtNum(r.maxHp)} HP"
													>
														<span
															class="block h-full bg-emerald-500/80"
															style="width: {pct(r.hp, r.maxHp)}%"
														></span>
													</Tip>
												{/if}
											</span>
										</div>
									{/each}
								</div>
							{/if}
						</Card.Root>
					{/each}
				</Tabs.Content>

				<!-- LOOT -->
				<Tabs.Content value="loot" class="mt-4 space-y-4">
					{#if run.progress?.length}
						{@const hours = Math.max(run.durationMs, 60_000) / 3_600_000}
						<div class="grid gap-3 md:grid-cols-2">
							{#each run.progress as g (g.slug)}
								<Card.Root class="space-y-2 p-4 text-sm">
									<div class="flex items-baseline justify-between gap-2">
										<span
											class="font-semibold"
											style="color: {classColor(classes[g.slug] ?? undefined)}"
											>{names[g.slug] ?? g.slug}</span
										>
										<span class="text-xs text-muted-foreground">coin &amp; glory</span>
									</div>
									<div class="grid grid-cols-2 gap-2">
										<div>
											<div class="text-xs text-muted-foreground uppercase">Experience</div>
											<div class="text-lg font-bold text-primary tabular-nums">{fmtNum(g.xp)}</div>
											<div class="text-xs text-muted-foreground tabular-nums">
												{fmtNum(Math.round(g.xp / hours))}/h{#if g.xpBonus}
													· {fmtNum(g.xpBonus)} group bonus{/if}
											</div>
										</div>
										<div>
											<div class="text-xs text-muted-foreground uppercase">Money</div>
											<div class="text-lg font-bold text-primary tabular-nums">
												{fmtMoney(g.copper)}
											</div>
											<div class="text-xs text-muted-foreground tabular-nums">
												{fmtMoney(g.copper / hours)}/h
											</div>
										</div>
									</div>
									{#if g.levels.length}
										<div class="text-xs">
											🎉 Reached level {g.levels.join(', ')} in here. Ding!
										</div>
									{/if}
									{#if g.reputation.length}
										<div class="text-xs text-muted-foreground">
											Reputation: {g.reputation
												.map((r) => `${r.faction} ${r.amount > 0 ? '+' : ''}${r.amount}`)
												.join(' · ')}
										</div>
									{/if}
									{#if g.castFails}
										{@const f = g.castFails}
										<div class="text-xs text-muted-foreground">
											Failed casts: <b class="text-foreground tabular-nums">{fmtNum(f.total)}</b>
											– {[
												f.spam && `${f.spam} button mashing`,
												f.targeting && `${f.targeting} at nothing`,
												f.interrupted && `${f.interrupted} interrupted`,
												f.resources && `${f.resources} out of mana`,
												f.range && `${f.range} out of range`,
												f.control && `${f.control} while CC'd`
											]
												.filter(Boolean)
												.join(' · ')}
										</div>
									{/if}
									{#if g.skills.length}
										<div class="text-xs text-muted-foreground">
											Skill-ups: {g.skills.map((k) => `${k.skill} ${k.from}→${k.to}`).join(' · ')}
										</div>
									{/if}
								</Card.Root>
							{/each}
						</div>
					{/if}
					{#if !loot.length}
						<Card.Root class="p-6 text-sm text-muted-foreground">
							No loot recorded. Either nobody had <code class="text-primary">/chatlog</code> on, or this
							party walked past every corpse without looting. Animals.
						</Card.Root>
					{:else}
						<div class="flex flex-wrap gap-2">
							{#each lootBy as g (g.slug ?? g.name)}
								<Card.Root class="px-3 py-2 text-sm">
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
								</Card.Root>
							{/each}
						</div>
						{#if rolls.length}
							<h3 class="eyebrow pt-2 text-primary">Need, greed &amp; broken friendships</h3>
							{#if dice.length > 1}
								<div class="flex flex-wrap gap-2 text-sm">
									{#each dice as d, i (d.slug)}
										<Card.Root class="px-3 py-2">
											<span
												class="font-semibold"
												style="color: {classColor(classes[d.slug] ?? undefined)}">{d.name}</span
											>
											<span class="ml-1 text-muted-foreground tabular-nums"
												>avg {Math.round(d.sum / d.n)} · {d.wins} won{#if d.needs}&nbsp;· {d.needs} need{d.needs ===
													1
														? ''
														: 's'}{/if}</span
											>
											{#if i === 0}<span class="ml-1 text-xs text-primary"
													>· blessed by RNGesus</span
												>{/if}
											{#if i === dice.length - 1}<span class="ml-1 text-xs text-destructive"
													>· cursed dice</span
												>{/if}
										</Card.Root>
									{/each}
								</div>
							{/if}
							<Card.Root class="overflow-hidden">
								<Table.Root class="w-full text-sm">
									<Table.Header class="text-xs text-muted-foreground">
										<Table.Row class="border-b border-border/50">
											<SortHead sort={rollSort} key="when" first="asc" class="w-20 px-3"
												>When</SortHead
											>
											<SortHead sort={rollSort} key="item" first="asc" class="px-3">Item</SortHead>
											<SortHead sort={rollSort} key="top" class="px-3" title="Highest roll"
												>Rolls</SortHead
											>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{#each rollRows as r, i (i)}
											<Table.Row class="border-b border-border/30 align-top last:border-0">
												<Table.Cell class="px-3 py-1.5 text-muted-foreground tabular-nums"
													>{fmtDuration(Math.max(0, r.atMs))}</Table.Cell
												>
												<Table.Cell class="px-3 py-1.5">
													<ItemLink
														name={r.item}
														color={lootColor(r.quality)}
														detail={r.itemId ? itemDetail.get(r.itemId) : null}
													/>
													{#if !r.winner}<div class="text-xs text-muted-foreground">
															Nobody wanted it. Not even the vendor.
														</div>{/if}
												</Table.Cell>
												<Table.Cell class="px-3 py-1.5">
													<div class="flex flex-wrap gap-x-3 gap-y-0.5">
														{#each sortedEntries(r) as e (e.slug)}
															<span class={e.choice === 'pass' ? 'text-muted-foreground' : ''}>
																<span
																	class={r.winner === e.slug ? 'font-bold' : ''}
																	style="color: {e.choice === 'pass'
																		? 'inherit'
																		: classColor(classes[e.slug] ?? undefined)}"
																	>{names[e.slug] ?? e.name}</span
																>
																<span class="text-xs tabular-nums"
																	>{e.choice === 'pass'
																		? 'pass'
																		: `${CHOICE[e.choice]} ${e.roll ?? '?'}`}{#if r.winner === e.slug}&nbsp;🎲{/if}</span
																>
															</span>
														{/each}
													</div>
												</Table.Cell>
											</Table.Row>
										{/each}
									</Table.Body>
								</Table.Root>
							</Card.Root>
							<h3 class="eyebrow pt-2 text-primary">Everything looted</h3>
						{/if}
						<Card.Root class="overflow-hidden">
							<Table.Root class="w-full text-sm">
								<Table.Header class="text-xs text-muted-foreground">
									<Table.Row class="border-b border-border/50">
										<SortHead sort={lootSort} key="when" first="asc" class="w-20 px-3"
											>When</SortHead
										>
										<SortHead sort={lootSort} key="item" first="asc" class="px-3">Item</SortHead>
										<SortHead sort={lootSort} key="quality" class="px-3" title="Item quality"
											>Quality</SortHead
										>
										<SortHead sort={lootSort} key="who" first="asc" class="px-3"
											>Grabbed by</SortHead
										>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each lootRows as l, i (i)}
										<Table.Row class="border-b border-border/30 last:border-0">
											<Table.Cell class="px-3 py-1.5 text-muted-foreground tabular-nums"
												>{fmtDuration(Math.max(0, l.atMs))}</Table.Cell
											>
											<Table.Cell class="px-3 py-1.5">
												<ItemLink
													name={l.item}
													color={lootColor(l.quality)}
													detail={l.itemId ? itemDetail.get(l.itemId) : null}
												/>
												{#if l.count > 1}<span class="text-muted-foreground"> ×{l.count}</span>{/if}
											</Table.Cell>
											<Table.Cell class="px-3 py-1.5 text-xs" style="color: {lootColor(l.quality)}"
												>{l.quality != null ? (QUALITY_NAME[l.quality] ?? '') : '—'}</Table.Cell
											>
											<Table.Cell class="px-3 py-1.5">
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
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</Card.Root>
						<p class="text-xs text-muted-foreground">
							From the uploader's <code>/chatlog</code>.{#if !rolls.length}
								No need/greed rolls on file — recorded by an older Companion, or nobody rolled.{/if}
						</p>
					{/if}
				</Tabs.Content>

				<!-- BIG NUMBERS -->

				<!-- TIMELINE -->
				<Tabs.Content value="timeline" class="mt-4">
					{#if run.timeline}
						<Card.Root class="p-4">
							<RunTimeline
								timeline={run.timeline}
								segments={run.segments ?? []}
								{names}
								{classes}
							/>
						</Card.Root>
					{/if}
				</Tabs.Content>

				<!-- REPLAY (naloži se samo, ko je zavihek odprt) -->
				<Tabs.Content value="replay" class="mt-4">
					{#if run.hasReplay}
						<RunReplay
							runId={id}
							zone={run.zone}
							instanceId={run.instanceId}
							durationMs={run.durationMs}
							segments={run.segments ?? []}
							deaths={run.deaths ?? []}
							timeline={run.timeline}
							{names}
							{classes}
						/>
					{/if}
				</Tabs.Content>

				<!-- SPELLS -->
				<Tabs.Content value="spells" class="mt-4 space-y-3">
					<ToggleGroup.Root
						type="single"
						variant="outline"
						spacing={1}
						class="flex-wrap"
						aria-label="Hero"
						bind:value={() => spellPlayer?.slug ?? '', (v) => v && (spellsFor = v)}
					>
						{#each players as p (p.slug)}
							<ToggleGroup.Item
								value={p.slug}
								class="data-[state=on]:text-[var(--hero)]"
								style="color: {classColor(p.classId ?? undefined)}; --hero: {classColor(
									p.classId ?? undefined
								)}">{p.name}</ToggleGroup.Item
							>
						{/each}
					</ToggleGroup.Root>
					{#if spellPlayer?.combat}
						<Card.Root class="space-y-2 p-4">
							<h3 class="font-display font-semibold text-primary">
								Whole run, grouped like the game's Combat Log Config
							</h3>
							<CombatLogPanel combat={spellPlayer.combat} secs={run.durationMs / 1000} />
						</Card.Root>
					{/if}
					{#if spellPlayer}
						<div class="grid gap-4 lg:grid-cols-2">
							{#each [['Damage', spellPlayer.topDamage, spellPlayer.damage], ['Healing', spellPlayer.topHealing, spellPlayer.healing]] as const as [label, list, total] (label)}
								<Card.Root class="p-4">
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
								</Card.Root>
							{/each}
						</div>
					{/if}
				</Tabs.Content>
			{/if}
		</Tabs.Root>
	{/if}
</div>
