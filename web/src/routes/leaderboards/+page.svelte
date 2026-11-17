<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import Tip from '#lib/components/wow/Tip.svelte';
	// Lestvice slave in sramote + sestava druščine (iz rosterja in rekordov dungeon runov).
	import { useQuery } from 'convex-svelte';
	import Medal from '@lucide/svelte/icons/medal';
	import { api } from '#convex/_generated/api.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import Leaderboard from '#lib/components/wow/Leaderboard.svelte';
	import PageHeader from '#lib/components/wow/PageHeader.svelte';
	import type { RosterEntry } from '#lib/types.js';
	import { classColor, fmt, weekSince } from '#lib/wow.js';

	const roster = useQuery(api.players.list, { since: weekSince() });
	// rekordi iz dungeon runov (Companion): null = skrito za obiskovalca
	const topCrits = useQuery(api.runs.topRecords, { kind: 'crit' });
	const topTaken = useQuery(api.runs.topRecords, { kind: 'hitTaken' });
	const recBy = (rows: { slug: string; amount: number }[] | null | undefined) =>
		rows ? new Map(rows.map((r) => [r.slug, r.amount])) : null;
	const critBy = $derived(recBy(topCrits.data));
	const takenBy = $derived(recBy(topTaken.data));

	const players = $derived(roster.data?.players ?? []);
	const priv = $derived(roster.data?.private ?? false);
	const withData = $derived(players.filter((p) => p.summary));

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

<svelte:head><title>Leaderboards — WowCompany</title></svelte:head>

<div class="space-y-8">
	<PageHeader
		title="Leaderboards"
		icon={Medal}
		lead="Glory for the few, shame for everyone else. Updated every time somebody logs out."
	/>
	{#if roster.isLoading}
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each Array(6) as _, i (i)}<Skeleton class="h-48 rounded-lg" />{/each}
		</div>
	{:else}
		<section class="space-y-3">
			{#if !priv}
				<p class="section-lead">Some boards are members-only. The embarrassing ones, obviously.</p>
			{/if}
			<Tabs.Root value="glory">
				<Tabs.List>
					<Tabs.Trigger value="glory">Glory</Tabs.Trigger>
					<Tabs.Trigger value="week">This Week</Tabs.Trigger>
					<Tabs.Trigger value="shame">Hall of Shame</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="glory" class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Leaderboard
						title="Highest Level"
						note="touch grass? never heard of her"
						entries={withData}
						value={(c) => c.summary?.level}
					/>
					<Leaderboard
						title="Shiniest Gear"
						note="equipped item level, per Blizzard"
						entries={withData}
						value={(c) => c.summary?.ilvlEquipped}
					/>
					<Leaderboard
						title="Serial Killer"
						note="total things murdered"
						entries={withData}
						value={(c) => c.summary?.kills}
					/>
					<Leaderboard
						title="Errand Boy"
						note="quests done for random NPCs, unpaid"
						entries={withData}
						value={(c) => c.summary?.quests}
					/>
					<Leaderboard
						title="Hard to Kill"
						note="kills per death"
						entries={withData}
						value={kd}
						format={(n) => fmt(n, 1)}
					/>
					<Leaderboard
						title="Biggest Crit"
						note="one huge number in a dungeon, to compensate for everything else"
						entries={withData}
						value={(c) => (critBy ? (critBy.get(c.slug) ?? 0) : null)}
						empty="No crits on record. Run a dungeon with the Companion on."
					/>
					<Leaderboard
						title="Honor? What Honor"
						note="honorable kills"
						entries={withData}
						value={(c) => c.summary?.honorableKills}
						empty="Everybody's a pacifist. Cowards."
					/>
				</Tabs.Content>
				<Tabs.Content value="week" class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Leaderboard
						title="No-Lifer of the Week"
						note="levels gained in 7 days"
						entries={withData}
						value={(c) => c.week?.level}
						format={(n) => `+${n}`}
						empty="Nobody leveled. Did everyone get a life?"
					/>
					<Leaderboard
						title="Weekly Body Count"
						note="kills in 7 days"
						entries={withData}
						value={(c) => c.week?.kills}
						format={(n) => `+${fmt(n)}`}
					/>
					<Leaderboard
						title="Weekly Errands"
						note="quests in 7 days"
						entries={withData}
						value={(c) => c.week?.quests}
						format={(n) => `+${fmt(n)}`}
					/>
					<Leaderboard
						title="Died This Week"
						note="the spirit healer sends regards"
						entries={withData}
						value={(c) => c.week?.deaths}
						format={(n) => `+${fmt(n)}`}
						empty="Nobody died this week. Suspicious."
					/>
					<Leaderboard
						title="Glow-Up"
						note="ilvl gained in 7 days"
						entries={withData}
						value={(c) => c.week?.ilvl}
						format={(n) => `+${n}`}
					/>
					<Leaderboard
						title="Weekly Gankers"
						note="honorable kills in 7 days"
						entries={withData}
						value={(c) => c.week?.honorableKills}
						format={(n) => `+${fmt(n)}`}
					/>
				</Tabs.Content>
				<Tabs.Content value="shame" class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Leaderboard
						title="Professional Corpse"
						note="most deaths, lovingly counted"
						entries={withData}
						value={(c) => c.summary?.deaths}
					/>
					<Leaderboard
						title="Gravity's Favorite"
						note="deaths by falling. it's not that hard."
						entries={withData}
						value={(c) => ctr(c, 'falling_deaths')}
						empty="Nobody fell to death yet. Give it time."
					/>
					<Leaderboard
						title="Glass Jaw"
						note="hardest single hit ever taken in a dungeon"
						entries={withData}
						value={(c) => (takenBy ? (takenBy.get(c.slug) ?? 0) : null)}
						empty="Nobody got slapped on record yet."
					/>
					<Leaderboard
						title="Bottomless Pit"
						note="food eaten"
						entries={withData}
						value={(c) => ctr(c, 'food')}
					/>
					<Leaderboard
						title="Functional Alcoholic"
						note="drinks consumed"
						entries={withData}
						value={(c) => ctr(c, 'drinks')}
					/>
					<Leaderboard
						title="Homesick Little Baby"
						note="hearthstone uses"
						entries={withData}
						value={(c) => ctr(c, 'hearthed')}
					/>
					<Leaderboard
						title="Greedy Bastard"
						note="NEED rolls on loot"
						entries={withData}
						value={(c) => ctr(c, 'need_rolls')}
					/>
					<Leaderboard
						title="Fish Whisperer"
						note="fish caught. we don't ask why."
						entries={withData}
						value={(c) => ctr(c, 'fish')}
					/>
					<Leaderboard
						title="Field Medic"
						note="bandages slapped on"
						entries={withData}
						value={(c) => ctr(c, 'bandages')}
					/>
					<Leaderboard
						title="Frequent Flyer"
						note="flight paths taken"
						entries={withData}
						value={(c) => ctr(c, 'flight_paths')}
					/>
				</Tabs.Content>
			</Tabs.Root>
		</section>

		<!-- class mix -->
		{#if classes.length}
			<Card.Root class="p-5">
				<h3 class="card-title">Party Composition</h3>
				<p class="section-lead mb-3 italic">a raid leader's nightmare</p>
				<div class="flex h-3 gap-0.5 overflow-hidden rounded-full">
					{#each classes as cl (cl.name)}
						<Tip
							as="div"
							style="flex: {cl.n}; background: {classColor(cl.id)}"
							text="{cl.name}: {cl.n}"
						/>
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
			</Card.Root>
		{/if}
	{/if}
</div>
