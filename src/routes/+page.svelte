<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import Skull from '@lucide/svelte/icons/skull';
	import { api } from '#convex/_generated/api.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { onMount } from 'svelte';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import List from '@lucide/svelte/icons/list';
	import Search from '@lucide/svelte/icons/search';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Input } from '#lib/components/ui/input/index.js';
	import CharacterCard from '#lib/components/wow/CharacterCard.svelte';
	import RosterTable from '#lib/components/wow/RosterTable.svelte';
	import GossipFeed from '#lib/components/wow/GossipFeed.svelte';
	import Leaderboard from '#lib/components/wow/Leaderboard.svelte';
	import Locked from '#lib/components/wow/Locked.svelte';
	import type { RosterEntry } from '#lib/types.js';
	import { classColor, fmt, weekSince } from '#lib/wow.js';

	const roster = useQuery(api.players.list, { since: weekSince() });
	const feed = useQuery(api.events.recent, { limit: 30 });

	type SortKey = 'level' | 'seen' | 'name';
	let sort = $state<SortKey>('level');

	// --- prikaz roster: kartice ali kompakten seznam (privzeto seznam pri > 8 junakih)
	type View = 'cards' | 'list';
	/** junakov na stran: 2 × 2 kartici ali 8 vrstic tabele (ista višina panela) */
	const PAGE_SIZE: Record<View, number> = { cards: 4, list: 8 };
	let viewChoice = $state<View | null>(null);
	let query = $state('');
	let page = $state(0);
	onMount(() => {
		try {
			const v = localStorage.getItem('roster-view');
			if (v === 'cards' || v === 'list') viewChoice = v;
		} catch {
			/* zasebno okno ipd. */
		}
	});
	function setView(v: View) {
		viewChoice = v;
		page = 0;
		try {
			localStorage.setItem('roster-view', v);
		} catch {
			/* ni pomembno */
		}
	}

	const players = $derived(roster.data?.players ?? []);
	const priv = $derived(roster.data?.private ?? false);
	const pubSet = $derived(new Set(roster.data?.publicFields ?? []));
	const allowed = (f: string) => priv || pubSet.has(f);
	const view = $derived<View>(viewChoice ?? (players.length > 8 ? 'list' : 'cards'));
	const pageSize = $derived(PAGE_SIZE[view]);
	const withData = $derived(players.filter((p) => p.summary));
	const sorted = $derived(
		[...players]
			.filter((p) => {
				const q = query.trim().toLowerCase();
				if (!q) return true;
				const sm = p.summary;
				return [p.displayName, sm?.className, sm?.race, sm?.guild, sm?.talentSpec].some((x) => x?.toLowerCase().includes(q));
			})
			.sort((a, b) => {
			if (sort === 'name') return a.displayName.localeCompare(b.displayName);
			if (sort === 'seen') return (b.summary?.lastLogin ?? 0) - (a.summary?.lastLogin ?? 0);
			return (b.summary?.level ?? 0) - (a.summary?.level ?? 0) || (b.summary?.experience ?? 0) - (a.summary?.experience ?? 0);
		})
	);

	const pages = $derived(Math.max(1, Math.ceil(sorted.length / pageSize)));
	const pageIdx = $derived(Math.min(page, pages - 1));
	const pageRows = $derived(sorted.slice(pageIdx * pageSize, pageIdx * pageSize + pageSize));
	const go = (d: number) => (page = Math.max(0, Math.min(pages - 1, pageIdx + d)));

	const sum = (f: (c: RosterEntry) => number | null | undefined) => {
		const vals = withData.map(f).filter((v): v is number => typeof v === 'number');
		return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
	};
	const top = $derived([...withData].sort((a, b) => (b.summary?.level ?? 0) - (a.summary?.level ?? 0))[0]);
	const avgLevel = $derived(withData.length ? (sum((c) => c.summary?.level) ?? 0) / withData.length : 0);
	const totalKills = $derived(sum((c) => c.summary?.kills));
	const totalDeaths = $derived(sum((c) => c.summary?.deaths));
	const weekLevels = $derived(sum((c) => c.week?.level));

	const classes = $derived(
		Object.values(
			withData.reduce<Record<string, { name: string; id: number; n: number }>>((acc, c) => {
				const k = c.summary?.className ?? '?';
				(acc[k] ??= { name: k, id: c.summary?.classId ?? 0, n: 0 }).n++;
				return acc;
			}, {})
		).sort((a, b) => b.n - a.n)
	);

	const ctr = (c: RosterEntry, k: string) => c.summary?.counters?.[k];
	const kd = (c: RosterEntry) => {
		const k = c.summary?.kills;
		const d = c.summary?.deaths;
		return k == null || d == null ? null : k / Math.max(1, d);
	};
</script>

<div class="space-y-10">
	<!-- hero -->
	<section class="space-y-2">
		<h1 class="text-3xl font-bold text-primary md:text-5xl">The Company of Questionable Decisions</h1>
		<p class="max-w-2xl text-muted-foreground">
			Levels, loot and spectacular deaths of our WoW Forever heroes. Mostly the deaths. Updated within minutes of
			someone finally logging off and going to bed.
		</p>
	</section>

	{#if roster.isLoading}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each Array(3) as _, i (i)}<Skeleton class="h-44 rounded-lg" />{/each}
		</div>
	{:else if roster.error}
		<div class="wow-frame rounded-lg p-6 text-destructive">The server died. Again. ({roster.error.message})</div>
	{:else if players.length === 0}
		<div class="wow-frame flex flex-col items-center gap-3 rounded-lg p-12 text-center">
			<Skull class="size-12 text-primary/70" />
			<h2 class="text-xl font-semibold">No heroes yet</h2>
			<p class="text-muted-foreground">Even the Scourge has more friends than this.</p>
		</div>
	{:else}
		<!-- team tiles -->
		<section class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
			{#each [
				{ l: 'Adventurers', v: fmt(players.length), s: 'and counting (barely)' },
				{ l: 'Average level', v: fmt(avgLevel, 1), s: 'mediocre, statistically' },
				{ l: 'Top dog', v: top?.summary?.level != null ? `${top.summary.level}` : '–', s: top?.displayName },
				{ l: 'Levels this week', v: weekLevels == null ? null : `+${fmt(weekLevels)}`, s: 'jobs neglected' },
				{ l: 'Things murdered', v: totalKills == null ? null : fmt(totalKills), s: 'boars mostly' },
				{ l: 'Times eaten dirt', v: totalDeaths == null ? null : fmt(totalDeaths), s: 'group total, shameful' }
			] as tile (tile.l)}
				<div class="wow-frame rounded-lg p-3">
					<div class="text-xs text-muted-foreground">{tile.l}</div>
					<div class="font-display text-2xl font-bold tabular-nums">
						{#if tile.v == null}<Locked compact />{:else}{tile.v}{/if}
					</div>
					{#if tile.s}<div class="truncate text-xs text-muted-foreground italic">{tile.s}</div>{/if}
				</div>
			{/each}
		</section>

		<!--
			Roster + Tavern Gossip: roster ima fiksno višino (2 × 2 kartici ali 8 vrstic), več junakov = listanje/iskanje.
			Gossip se raztegne točno na višino rosterja (absolutno pozicioniran znotraj stolpca) in ima lasten drsnik.
		-->
		<div class="grid gap-8 lg:grid-cols-[1fr_340px]">
			<!-- roster -->
			<section class="min-w-0 space-y-3" aria-label="Roster">
				<div class="flex h-9 items-center justify-between gap-2">
					<h2 class="text-xl font-semibold">
						The Roster <span class="text-base font-normal text-muted-foreground">({players.length})</span>
					</h2>
					<div class="flex items-center gap-2">
						<div class="hidden gap-1 text-sm sm:flex" role="group" aria-label="Sort">
							{#each [['level', 'level'], ['seen', 'last seen'], ['name', 'name']] as [k, l] (k)}
								<button
									class="rounded-md px-2.5 py-1 transition-colors {sort === k
										? 'bg-primary text-primary-foreground'
										: 'text-muted-foreground hover:bg-accent'}"
									onclick={() => ((sort = k as SortKey), (page = 0))}>{l}</button
								>
							{/each}
						</div>
						<div class="flex rounded-md border border-border p-0.5" role="group" aria-label="View">
							<button
								class="rounded p-1 {view === 'cards' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
								aria-label="Cards"
								aria-pressed={view === 'cards'}
								title="Cards"
								onclick={() => setView('cards')}><LayoutGrid class="size-4" /></button
							>
							<button
								class="rounded p-1 {view === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
								aria-label="List"
								aria-pressed={view === 'list'}
								title="List"
								onclick={() => setView('list')}><List class="size-4" /></button
							>
						</div>
					</div>
				</div>

				<!-- orodna vrstica: iskanje + listanje (vedno prisotna -> višina se ne spreminja) -->
				<div class="flex h-9 items-center gap-2">
					<div class="relative min-w-0 flex-1">
						<Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input bind:value={query} oninput={() => (page = 0)} placeholder="Find a hero, class, spec or guild…" class="h-9 pl-8" />
					</div>
					<div class="flex shrink-0 items-center gap-1">
						<button
							class="grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
							aria-label="Previous heroes"
							disabled={pageIdx === 0}
							onclick={() => go(-1)}><ChevronLeft class="size-4" /></button
						>
						<span class="w-[5.5rem] text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">
							{#if sorted.length}{pageIdx * pageSize + 1}–{Math.min(sorted.length, (pageIdx + 1) * pageSize)} of {sorted.length}{:else}0 of 0{/if}
						</span>
						<button
							class="grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
							aria-label="Next heroes"
							disabled={pageIdx >= pages - 1}
							onclick={() => go(1)}><ChevronRight class="size-4" /></button
						>
					</div>
				</div>

				<!-- telo: vedno enaka višina (sm+), na telefonu naravna višina -->
				<div class="sm:h-[25.5rem]">
					{#if sorted.length === 0}
						<p class="wow-frame grid h-full place-items-center rounded-lg p-6 text-center text-sm text-muted-foreground italic">
							Nobody matches "{query}". Maybe they quit. Maybe they're hiding. Probably hiding.
						</p>
					{:else if view === 'list'}
						<RosterTable rows={pageRows} {allowed} />
					{:else}
						<div class="grid h-full gap-4 sm:grid-cols-2 sm:grid-rows-2">
							{#each pageRows as c (c.slug)}<CharacterCard {c} />{/each}
						</div>
					{/if}
				</div>
			</section>

			<!-- gossip: na lg točno višina rosterja -->
			<aside class="relative min-w-0">
				<div class="flex flex-col gap-3 lg:absolute lg:inset-0">
					<div class="flex h-9 shrink-0 items-center">
						<h2 class="text-xl font-semibold">Tavern Gossip</h2>
					</div>
					<GossipFeed
						events={feed.data ?? []}
						showTitle={false}
						locked={!allowed('lastLogin')}
						class="wow-scroll max-h-[28rem] min-h-0 flex-1 overflow-y-auto overscroll-contain lg:max-h-none"
					/>
				</div>
			</aside>
		</div>

		<!-- leaderboards -->
		<section class="space-y-3">
			<h2 class="text-xl font-semibold">Leaderboards of Glory & Shame</h2>
			{#if !priv}
				<p class="text-sm text-muted-foreground">Some boards are members-only. The embarrassing ones, obviously.</p>
			{/if}
			<Tabs.Root value="glory">
				<Tabs.List>
					<Tabs.Trigger value="glory">Glory</Tabs.Trigger>
					<Tabs.Trigger value="week">This Week</Tabs.Trigger>
					<Tabs.Trigger value="shame">Hall of Shame</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="glory" class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Leaderboard title="Highest Level" note="touch grass? never heard of her" entries={withData} value={(c) => c.summary?.level} />
					<Leaderboard title="Shiniest Gear" note="equipped item level, per Blizzard" entries={withData} value={(c) => c.summary?.ilvlEquipped} />
					<Leaderboard title="Serial Killer" note="total things murdered" entries={withData} value={(c) => c.summary?.kills} />
					<Leaderboard title="Errand Boy" note="quests done for random NPCs, unpaid" entries={withData} value={(c) => c.summary?.quests} />
					<Leaderboard title="Hard to Kill" note="kills per death" entries={withData} value={kd} format={(n) => fmt(n, 1)} />
					<Leaderboard title="Honor? What Honor" note="honorable kills" entries={withData} value={(c) => c.summary?.honorableKills} empty="Everybody's a pacifist. Cowards." />
				</Tabs.Content>
				<Tabs.Content value="week" class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Leaderboard title="No-Lifer of the Week" note="levels gained in 7 days" entries={withData} value={(c) => c.week?.level} format={(n) => `+${n}`} empty="Nobody leveled. Did everyone get a life?" />
					<Leaderboard title="Weekly Body Count" note="kills in 7 days" entries={withData} value={(c) => c.week?.kills} format={(n) => `+${fmt(n)}`} />
					<Leaderboard title="Weekly Errands" note="quests in 7 days" entries={withData} value={(c) => c.week?.quests} format={(n) => `+${fmt(n)}`} />
					<Leaderboard title="Died This Week" note="the spirit healer sends regards" entries={withData} value={(c) => c.week?.deaths} format={(n) => `+${fmt(n)}`} empty="Nobody died this week. Suspicious." />
					<Leaderboard title="Glow-Up" note="ilvl gained in 7 days" entries={withData} value={(c) => c.week?.ilvl} format={(n) => `+${n}`} />
					<Leaderboard title="Weekly Gankers" note="honorable kills in 7 days" entries={withData} value={(c) => c.week?.honorableKills} format={(n) => `+${fmt(n)}`} />
				</Tabs.Content>
				<Tabs.Content value="shame" class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Leaderboard title="Professional Corpse" note="most deaths, lovingly counted" entries={withData} value={(c) => c.summary?.deaths} />
					<Leaderboard title="Gravity's Favorite" note="deaths by falling. it's not that hard." entries={withData} value={(c) => ctr(c, 'falling_deaths')} empty="Nobody fell to death yet. Give it time." />
					<Leaderboard title="Bottomless Pit" note="food eaten" entries={withData} value={(c) => ctr(c, 'food')} />
					<Leaderboard title="Functional Alcoholic" note="drinks consumed" entries={withData} value={(c) => ctr(c, 'drinks')} />
					<Leaderboard title="Homesick Little Baby" note="hearthstone uses" entries={withData} value={(c) => ctr(c, 'hearthed')} />
					<Leaderboard title="Greedy Bastard" note="NEED rolls on loot" entries={withData} value={(c) => ctr(c, 'need_rolls')} />
					<Leaderboard title="Fish Whisperer" note="fish caught. we don't ask why." entries={withData} value={(c) => ctr(c, 'fish')} />
					<Leaderboard title="Field Medic" note="bandages slapped on" entries={withData} value={(c) => ctr(c, 'bandages')} />
					<Leaderboard title="Frequent Flyer" note="flight paths taken" entries={withData} value={(c) => ctr(c, 'flight_paths')} />
				</Tabs.Content>
			</Tabs.Root>
		</section>

		<!-- class mix -->
		{#if classes.length}
			<section class="wow-frame rounded-lg p-4">
				<h3 class="mb-1 text-sm font-semibold text-primary">Party Composition</h3>
				<p class="mb-3 text-xs text-muted-foreground italic">a raid leader's nightmare</p>
				<div class="flex h-3 gap-0.5 overflow-hidden rounded-full">
					{#each classes as cl (cl.name)}
						<div style="flex: {cl.n}; background: {classColor(cl.id)}" title="{cl.name}: {cl.n}"></div>
					{/each}
				</div>
				<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
					{#each classes as cl (cl.name)}
						<li class="flex items-center gap-1.5">
							<span class="size-2.5 rounded-full" style="background: {classColor(cl.id)}"></span>
							{cl.name} <span class="text-muted-foreground">{cl.n}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>
