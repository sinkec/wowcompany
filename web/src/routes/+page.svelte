<script lang="ts">
	// Naslovnica (landing): hero z junaki, kaj prihaja (koledar) + zadnji runi, novice.
	// Roster je na /heroes, lestvice na /leaderboards.
	import { useQuery, usePaginatedQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import HomeHero from '#lib/components/wow/HomeHero.svelte';
	import NewsSection from '#lib/components/wow/NewsSection.svelte';
	import UpcomingEvents from '#lib/components/wow/UpcomingEvents.svelte';
	import RunRow from '#lib/components/wow/RunRow.svelte';
	import HomePanel from '#lib/components/wow/HomePanel.svelte';
	import { hourNow } from '#lib/calendar.js';
	import { fmt, weekSince } from '#lib/wow.js';

	const roster = useQuery(api.players.list, { since: weekSince() });
	const news = useQuery(api.news.list, { limit: 6 });
	const site = useQuery(api.site.home, {});
	const upcoming = useQuery(api.calendar.upcoming, { from: hourNow(), limit: 12 });
	const access = useQuery(api.runs.access, {});
	const runs = usePaginatedQuery(api.runs.list, {}, { initialNumItems: 10 });

	const players = $derived(roster.data?.players ?? []);
	const withData = $derived(players.filter((p) => p.summary));
	const sum = (vals: (number | null | undefined)[]) => {
		const xs = vals.filter((v): v is number => typeof v === 'number');
		return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
	};
	const stats = $derived(
		[
			{ label: 'Adventurers', value: players.length ? fmt(players.length) : null },
			{
				label: 'Average level',
				value: withData.length
					? fmt((sum(withData.map((c) => c.summary?.level)) ?? 0) / withData.length, 1)
					: null
			},
			{
				label: 'Levels this week',
				value: ((n) => (n == null ? null : `+${fmt(n)}`))(sum(withData.map((c) => c.week?.level)))
			},
			{
				label: 'Things murdered',
				value: ((n) => (n == null ? null : fmt(n)))(sum(withData.map((c) => c.summary?.kills)))
			},
			{
				label: 'Times eaten dirt',
				value: ((n) => (n == null ? null : fmt(n)))(sum(withData.map((c) => c.summary?.deaths)))
			}
		].filter((x): x is { label: string; value: string } => x.value != null)
	);
	const showRuns = $derived(access.data?.runs !== false && runs.results.length > 0);
</script>

<div class="space-y-12">
	<HomeHero
		backdrop={news.data?.find((n) => n.image)?.image ?? null}
		heroes={withData.map((c) => ({
			slug: c.slug,
			name: c.displayName,
			level: c.summary?.level ?? null,
			classId: c.summary?.classId ?? null,
			avatar: c.summary?.avatar ?? null
		}))}
		{stats}
		quips={site.data?.quips ?? []}
		convos={site.data?.convos ?? []}
		socials={site.data?.socials ?? []}
	/>

	<!-- fiksna višina obeh plošč, runi ozki stolpec: brez praznin, klik vodi na podrobnosti -->
	<div class="grid gap-6 {showRuns ? 'lg:grid-cols-[minmax(0,1fr)_23rem]' : ''}">
		<HomePanel
			title="Coming up"
			href="/calendar"
			more="Calendar"
			id="upcoming-title"
			end={upcoming.data?.length
				? "That's the plan. Plans are for people who don't wipe."
				: undefined}
		>
			<UpcomingEvents events={upcoming.data ?? []} loading={upcoming.isLoading} />
		</HomePanel>
		{#if showRuns}
			<HomePanel
				title="Latest runs"
				href="/runs"
				more="All runs"
				id="runs-title"
				end={runs.results.length < 10
					? "That's every run so far. Go make more corpses."
					: 'Older runs →'}
			>
				<ul class="divide-y divide-border/40">
					{#each runs.results as run (run.id)}<li><RunRow {run} /></li>{/each}
				</ul>
			</HomePanel>
		{/if}
	</div>

	<NewsSection news={news.data ?? []} />
</div>
