<script lang="ts">
	import { usePaginatedQuery, useQuery } from 'convex-svelte';
	import Swords from '@lucide/svelte/icons/swords';
	import { api } from '#convex/_generated/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import Locked from '#lib/components/wow/Locked.svelte';
	import RunCard from '#lib/components/wow/RunCard.svelte';

	const access = useQuery(api.runs.access, {});
	const runs = usePaginatedQuery(api.runs.list, {}, { initialNumItems: 15 });
</script>

<svelte:head><title>Dungeon Runs — WowCompany</title></svelte:head>

<div class="space-y-6">
	<section class="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
		<div class="min-w-0 space-y-1 sm:flex-1">
			<h1 class="flex items-center gap-3 text-3xl font-bold text-primary md:text-4xl">
				<Swords class="size-8" /> Dungeon Runs
			</h1>
			<p class="text-muted-foreground">
				Every dungeon the party survived — or didn't. Recorded by the Companion app, uploaded by
				whoever was snitching, judged by everyone. Click a run for the full autopsy.
			</p>
		</div>
		<a href="/link#download" class="shrink-0 text-sm text-primary hover:underline"
			>Get the Companion app →</a
		>
	</section>

	{#if access.data && !access.data.runs}
		<Locked what="our dungeon runs (and the bodies we left behind)" />
	{:else if runs.isLoading && !runs.results.length}
		<div class="space-y-3">
			{#each [1, 2, 3] as i (i)}<div class="h-32 animate-pulse rounded-lg bg-muted"></div>{/each}
		</div>
	{:else if !runs.results.length}
		<div class="wow-frame flex flex-col items-center gap-3 rounded-lg p-10 text-center">
			<p class="text-5xl">🕯️</p>
			<p class="font-display text-xl text-primary">No runs yet</p>
			<p class="max-w-md text-sm text-muted-foreground">
				The dungeons are suspiciously quiet. Either nobody installed the Companion, or everyone died
				before the log started. Install it, type <code class="text-primary">/combatlog</code>, go
				get murdered properly.
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each runs.results as run (run.id)}
				<RunCard {run} />
			{/each}
		</div>
		{#if runs.status === 'CanLoadMore' || runs.status === 'LoadingMore'}
			<div class="flex justify-center">
				<Button
					variant="outline"
					disabled={runs.status === 'LoadingMore'}
					onclick={() => runs.loadMore(15)}
				>
					{runs.status === 'LoadingMore' ? 'Digging up more corpses…' : 'Older runs'}
				</Button>
			</div>
		{:else}
			<p class="text-center text-xs text-muted-foreground italic">
				That's all of them. History ends here, mercifully.
			</p>
		{/if}
	{/if}
</div>
