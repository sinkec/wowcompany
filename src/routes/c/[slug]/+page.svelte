<script lang="ts">
	import { page } from '$app/state';
	import { useQuery } from 'convex-svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Ghost from '@lucide/svelte/icons/ghost';
	import { api } from '#convex/_generated/api.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import GossipFeed from '#lib/components/wow/GossipFeed.svelte';
	import ItemSlot from '#lib/components/wow/ItemSlot.svelte';
	import LineChart from '#lib/components/wow/LineChart.svelte';
	import TalentTree from '#lib/components/wow/TalentTree.svelte';
	import Locked from '#lib/components/wow/Locked.svelte';
	import type { Item, Profession, StatLine, TalentTree as Tree } from '#lib/types.js';
	import {
		COUNTER_LABELS,
		SLOTS_BOTTOM,
		SLOTS_LEFT,
		SLOTS_RIGHT,
		ago,
		classColor,
		deathTitle,
		fmt,
		kdQuip,
		weekSince
	} from '#lib/wow.js';

	const slug = $derived(page.params.slug ?? '');
	const since = weekSince();
	const q = useQuery(api.players.get, () => ({ slug, since }));
	const feed = useQuery(api.events.recent, () => ({ slug, limit: 8 }));

	const c = $derived(q.data);
	const s = $derived(c?.summary);
	const d = $derived(c?.details);
	const color = $derived(classColor(s?.classId));
	const equipment = $derived((d?.equipment ?? null) as Item[] | null);
	const bySlot = $derived(Object.fromEntries((equipment ?? []).map((i) => [i.slotType, i])));
	const stats = $derived((d?.stats ?? null) as Record<string, number | string> | null);
	const professions = $derived((d?.professions ?? null) as Profession[] | null);
	const talentTrees = $derived((d?.talents ?? null) as Tree[] | null);
	const topTree = $derived(talentTrees?.length ? [...talentTrees].sort((a, b) => b.spent - a.spent)[0] : null);
	const kd = $derived(s?.kills != null && s?.deaths != null ? s.kills / Math.max(1, s.deaths) : null);

	let statFilter = $state('');
	const statGroups = $derived.by(() => {
		const list = (d?.allStats ?? null) as StatLine[] | null;
		if (!list) return null;
		const f = statFilter.trim().toLowerCase();
		const groups = new Map<string, StatLine[]>();
		for (const l of list) {
			if (f && !l.name.toLowerCase().includes(f) && !l.category.toLowerCase().includes(f)) continue;
			if (!groups.has(l.category)) groups.set(l.category, []);
			groups.get(l.category)!.push(l);
		}
		return [...groups];
	});
	type HistCol = 'level' | 'ilvl' | 'kills' | 'quests' | 'deaths';
	/** null = stolpec je za tega gledalca skrit */
	const hist = (k: HistCol) =>
		c?.history?.some((h) => h[k] != null)
			? c.history.filter((h) => h[k] != null).map((h) => ({ t: h.at, v: h[k] as number }))
			: null;

	const n = (k: string) => (stats ? Number(stats[k] ?? 0) : 0);
	const pct = (k: string) => `${fmt(n(k), 2)} %`;
</script>

<svelte:head>
	{#if c}<title>{c.player.displayName} — WowCompany</title>{/if}
</svelte:head>

<div class="space-y-6">
	<a href="/" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
		<ArrowLeft class="size-4" /> back to the tavern
	</a>

	{#if q.isLoading}
		<Skeleton class="h-56 rounded-lg" />
		<Skeleton class="h-96 rounded-lg" />
	{:else if !c}
		<div class="wow-frame flex flex-col items-center gap-3 rounded-lg p-12 text-center">
			<Ghost class="size-12 text-primary/70" />
			<h1 class="text-2xl font-bold">Nobody here by that name</h1>
			<p class="text-muted-foreground">Either they quit, got kicked, or never existed. Rest in pixels.</p>
		</div>
	{:else}
		<!-- header -->
		<header class="wow-frame relative overflow-hidden rounded-lg">
			{#if d?.render}
				<img
					src={d.render}
					alt=""
					class="pointer-events-none absolute top-1/2 right-0 h-[260%] max-w-none -translate-y-[42%] opacity-40 [mask-image:linear-gradient(to_left,black_60%,transparent)] md:right-[2%] md:opacity-90"
				/>
			{/if}
			<div class="absolute inset-x-0 top-0 h-1" style="background: {color}"></div>
			<div class="relative flex flex-col gap-3 p-6 md:min-h-56">
				<div class="flex items-start gap-4">
					{#if s?.avatar}
						<img src={s.avatar} alt="" class="size-20 rounded-full border-2" style="border-color: {color}" />
					{/if}
					<div>
						<h1 class="text-3xl font-bold md:text-4xl" style="color: {color}">{c.player.displayName}</h1>
						{#if s}
							<p class="text-lg">Level {s.level} {s.race ?? ''} {s.className ?? ''}</p>
							<p class="text-sm text-muted-foreground">
								{[s.talentBuild ? `${s.talentSpec} ${s.talentBuild}` : null, s.guild ? `<${s.guild}>` : null, s.faction, s.ruleset, s.lastLogin ? `last seen ${ago(s.lastLogin)}` : null]
									.filter(Boolean)
									.join(' · ')}
							</p>
						{:else}
							<p class="text-muted-foreground italic">Blizzard hasn't coughed up any data yet. Log out, hero.</p>
						{/if}
					</div>
				</div>
				{#if s?.deaths != null}
					<p class="mt-auto font-display text-sm text-primary">“{deathTitle(s.deaths)}”</p>
				{/if}
			</div>
		</header>

		{#if s}
			<!-- quick tiles -->
			<section class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
				{#each [
					{ l: 'Item level', v: s.ilvlEquipped, sub: s.ilvlAverage != null ? `best owned ${s.ilvlAverage}` : '' },
					{ l: 'Things murdered', v: s.kills, sub: c.week?.kills ? `+${fmt(c.week.kills)} this week` : '' },
					{ l: 'Deaths', v: s.deaths, sub: kd != null ? `K/D ${fmt(kd, 1)} · ${kdQuip(kd)}` : '' },
					{ l: 'Quests', v: s.quests, sub: c.week?.quests ? `+${fmt(c.week.quests)} this week` : 'unpaid labor' },
					{ l: 'Honorable kills', v: s.honorableKills, sub: 'honor is relative' },
					{ l: 'Health', v: stats ? n('health') : null, sub: stats ? `${fmt(n('power'))} ${stats.powerType ?? ''}` : '' }
				] as t (t.l)}
					<div class="wow-frame rounded-lg p-3">
						<div class="text-xs text-muted-foreground">{t.l}</div>
						<div class="font-display text-2xl font-bold tabular-nums">
							{#if t.v == null}<Locked compact />{:else}{fmt(t.v)}{/if}
						</div>
						{#if t.sub}<div class="text-xs leading-snug text-muted-foreground italic">{t.sub}</div>{/if}
					</div>
				{/each}
			</section>

			<Tabs.Root value="gear">
				<Tabs.List class="flex-wrap">
					<Tabs.Trigger value="gear">Gear & Guts</Tabs.Trigger>
					<Tabs.Trigger value="talents">Talents</Tabs.Trigger>
					<Tabs.Trigger value="progress">Progress</Tabs.Trigger>
					<Tabs.Trigger value="prof">Professions</Tabs.Trigger>
					<Tabs.Trigger value="all">Every Stat Ever</Tabs.Trigger>
				</Tabs.List>

				<!-- gear + stats -->
				<Tabs.Content value="gear" class="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
					<section class="wow-frame rounded-lg p-4">
						{#if equipment}
							<div class="grid gap-x-6 sm:grid-cols-2">
								<div>{#each SLOTS_LEFT as sl (sl)}<ItemSlot slot={sl} item={bySlot[sl]} />{/each}</div>
								<div>{#each SLOTS_RIGHT as sl (sl)}<ItemSlot slot={sl} item={bySlot[sl]} align="right" />{/each}</div>
							</div>
							<div class="mt-3 grid gap-x-6 border-t border-border pt-3 sm:grid-cols-3">
								{#each SLOTS_BOTTOM as sl (sl)}<ItemSlot slot={sl} item={bySlot[sl]} />{/each}
							</div>
						{:else}
							<Locked what="what they're wearing (probably rags)" />
						{/if}
					</section>

					<section class="wow-frame space-y-4 rounded-lg p-4 text-sm">
						{#if stats}
							{#each [
								{ h: 'Base', rows: [['Strength', fmt(n('strength'))], ['Agility', fmt(n('agility'))], ['Stamina', fmt(n('stamina'))], ['Intellect', fmt(n('intellect'))], ['Spirit', fmt(n('spirit'))], ['Armor', fmt(n('armor'))]] },
								{ h: 'Melee / Ranged', rows: [['Attack power', fmt(n('attackPower'))], ['Ranged AP', fmt(n('rangedAttackPower'))], ['Crit', pct('meleeCrit')], ['Ranged crit', pct('rangedCrit')], ['Main hand DPS', fmt(n('mainHandDps'), 1)]] },
								{ h: 'Spells', rows: [['Spell power', fmt(n('spellPower'))], ['Healing', fmt(n('spellHealing'))], ['Spell crit', pct('spellCrit')], ['Mana regen', fmt(n('manaRegen'))]] },
								{ h: 'Defense', rows: [['Defense', fmt(n('defense'))], ['Dodge', pct('dodge')], ['Parry', pct('parry')], ['Block', pct('block')]] },
								{ h: 'Resistances', rows: [['Fire', fmt(n('resistFire'))], ['Frost', fmt(n('resistFrost'))], ['Shadow', fmt(n('resistShadow'))], ['Nature', fmt(n('resistNature'))], ['Arcane', fmt(n('resistArcane'))]] }
							] as g (g.h)}
								<div>
									<h3 class="mb-1 text-xs font-semibold tracking-wider text-primary uppercase">{g.h}</h3>
									<dl class="space-y-0.5">
										{#each g.rows as [k, v] (k)}
											<div class="flex justify-between"><dt class="text-muted-foreground">{k}</dt><dd class="tabular-nums">{v}</dd></div>
										{/each}
									</dl>
								</div>
							{/each}
						{:else}
							<Locked what="their pathetic stats" />
						{/if}
					</section>
				</Tabs.Content>

				<!-- talents -->
				<Tabs.Content value="talents" class="mt-4 space-y-3">
					{#if talentTrees == null}
						<Locked what="their talent choices (questionable, we assume)" />
					{:else if !talentTrees.some((t) => t.spent)}
						<p class="wow-frame rounded-lg p-8 text-center text-muted-foreground italic">
							No talent points spent. Either under level 10 or saving them for a special occasion.
						</p>
					{:else}
						<p class="text-sm text-muted-foreground">
							Build <span class="font-semibold text-foreground">{s.talentBuild ?? talentTrees.map((t) => t.spent).join('/')}</span>
							· mostly <span class="text-primary">{topTree?.name}</span>. Hover a talent for what it does. Gold = maxed.
						</p>
						<div class="grid gap-4 lg:grid-cols-3">
							{#each talentTrees as tree (tree.id)}<TalentTree {tree} top={tree.id === topTree?.id} />{/each}
						</div>
					{/if}
				</Tabs.Content>

				<!-- progress -->
				<Tabs.Content value="progress" class="mt-4 space-y-4">
					{#if c.history}
						<div class="grid gap-4 md:grid-cols-2">
							{#each [
								{ k: 'level', t: 'Level', col: color },
								{ k: 'ilvl', t: 'Item level', col: undefined },
								{ k: 'kills', t: 'Things murdered', col: undefined },
								{ k: 'deaths', t: 'Deaths (the climb of shame)', col: 'var(--color-destructive)' }
							] as ch (ch.k)}
								{@const pts = hist(ch.k as HistCol)}
								{#if pts}
									<LineChart title={ch.t} points={pts} color={ch.col} />
								{:else}
									<div class="wow-frame rounded-lg p-4">
										<div class="mb-2 text-sm font-semibold text-primary">{ch.t}</div>
										<Locked what="this chart" />
									</div>
								{/if}
							{/each}
						</div>
					{:else}
						<Locked what="their progress (or lack thereof)" />
					{/if}

					<div class="grid gap-4 lg:grid-cols-[1fr_340px]">
						<section class="wow-frame rounded-lg p-4">
							<h3 class="mb-3 text-sm font-semibold text-primary">Fun Facts Nobody Asked For</h3>
							{#if d?.counters}
								<dl class="grid grid-cols-2 gap-3 sm:grid-cols-3">
									{#each Object.entries(COUNTER_LABELS) as [k, label] (k)}
										{#if (d.counters[k] ?? 0) > 0}
											<div class="rounded-md bg-background/40 p-2">
												<dt class="text-xs text-muted-foreground">{label}</dt>
												<dd class="text-lg font-semibold tabular-nums">{fmt(d.counters[k])}</dd>
											</div>
										{/if}
									{/each}
								</dl>
							{:else}
								<Locked what="the embarrassing numbers" />
							{/if}
						</section>
						<GossipFeed events={feed.data ?? []} title="Recent Shenanigans" locked={!c.private && !(s && "lastLogin" in s)} />
					</div>
				</Tabs.Content>

				<!-- professions -->
				<Tabs.Content value="prof" class="mt-4">
					<section class="wow-frame rounded-lg p-4">
						{#if professions}
							<div class="grid gap-6 md:grid-cols-2">
								{#each [true, false] as primary (primary)}
									<div>
										<h3 class="mb-2 text-xs font-semibold tracking-wider text-primary uppercase">
											{primary ? 'Day Jobs' : 'Side Hustles'}
										</h3>
										{#each professions.filter((p) => p.primary === primary) as p (p.name)}
											<div class="mb-3">
												<div class="mb-1 flex justify-between text-sm">
													<span>{p.name}</span><span class="text-muted-foreground tabular-nums">{p.skill} / {p.max}</span>
												</div>
												<Progress value={p.skill} max={p.max || 1} />
											</div>
										{:else}
											<p class="text-sm text-muted-foreground italic">Unemployed. Lives off vendor trash.</p>
										{/each}
									</div>
								{/each}
							</div>
						{:else}
							<Locked what="their career choices" />
						{/if}
					</section>
				</Tabs.Content>

				<!-- all stats -->
				<Tabs.Content value="all" class="mt-4 space-y-3">
					{#if statGroups}
						<Input bind:value={statFilter} placeholder="Search stats… (try 'deaths', you know you want to)" class="max-w-sm" />
						<div class="columns-1 gap-4 md:columns-2 lg:columns-3">
							{#each statGroups as [cat, rows] (cat)}
								<section class="wow-frame mb-4 break-inside-avoid rounded-lg p-3">
									<h3 class="mb-1 text-xs font-semibold tracking-wider text-primary uppercase">{cat}</h3>
									{#each rows as r, i (i)}
										<div class="flex justify-between gap-3 text-sm">
											<span class="text-muted-foreground">{r.name}</span><span class="tabular-nums">{fmt(r.value)}</span>
										</div>
									{/each}
								</section>
							{:else}
								<p class="text-sm text-muted-foreground italic">Nothing matches. Unlike their gear.</p>
							{/each}
						</div>
					{:else}
						<Locked what="every stat ever" />
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		{/if}
	{/if}
</div>
