<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import Skull from '@lucide/svelte/icons/skull';
	import { api } from '#convex/_generated/api.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import CharacterCard from '#lib/components/wow/CharacterCard.svelte';
	import GossipFeed from '#lib/components/wow/GossipFeed.svelte';
	import Leaderboard from '#lib/components/wow/Leaderboard.svelte';
	import Locked from '#lib/components/wow/Locked.svelte';
	import type { RosterEntry } from '#lib/types.js';
	import { classColor, fmt, weekSince } from '#lib/wow.js';

	const roster = useQuery(api.players.list, { since: weekSince() });
	const feed = useQuery(api.events.recent, { limit: 12 });

	type SortKey = 'level' | 'seen' | 'name';
	let sort = $state<SortKey>('level');

	const players = $derived(roster.data?.players ?? []);
	const priv = $derived(roster.data?.private ?? false);
	const withData = $derived(players.filter((p) => p.summary));
	const sorted = $derived(
		[...players].sort((a, b) => {
			if (sort === 'name') return a.displayName.localeCompare(b.displayName);
			if (sort === 'seen') return (b.summary?.lastLogin ?? 0) - (a.summary?.lastLogin ?? 0);
			return (b.summary?.level ?? 0) - (a.summary?.level ?? 0) || (b.summary?.experience ?? 0) - (a.summary?.experience ?? 0);
		})
	);

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

		<div class="grid gap-8 lg:grid-cols-[1fr_340px]">
			<!-- roster -->
			<section class="space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="text-xl font-semibold">The Roster</h2>
					<div class="flex gap-1 text-sm" role="group" aria-label="Sort">
						{#each [['level', 'by level'], ['seen', 'last seen'], ['name', 'by name']] as [k, l] (k)}
							<button
								class="rounded-md px-2.5 py-1 transition-colors {sort === k
									? 'bg-primary text-primary-foreground'
									: 'text-muted-foreground hover:bg-accent'}"
								onclick={() => (sort = k as SortKey)}>{l}</button
							>
						{/each}
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					{#each sorted as c (c.slug)}<CharacterCard {c} />{/each}
				</div>
			</section>

			<!-- gossip -->
			<aside>
				<GossipFeed events={feed.data ?? []} />
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
