<script lang="ts">
	// Seznam runov: izbrano število na stran (5/10/20, zapomni si brskalnik) in oštevilčene strani.
	import { useQuery } from 'convex-svelte';
	import { onMount } from 'svelte';
	import Swords from '@lucide/svelte/icons/swords';
	import { api } from '#convex/_generated/api.js';
	import Locked from '#lib/components/wow/Locked.svelte';
	import RunCard from '#lib/components/wow/RunCard.svelte';
	import PageHeader from '#lib/components/wow/PageHeader.svelte';
	import Pager from '#lib/components/table/Pager.svelte';
	import * as Card from '#lib/components/ui/card/index.js';

	const access = useQuery(api.runs.access, {});
	let perPage = $state(10);
	let page = $state(1);
	onMount(() => {
		try {
			const n = Number(localStorage.getItem('runs-per-page'));
			if ([5, 10, 20].includes(n)) perPage = n;
		} catch {
			/* zasebno okno */
		}
	});
	$effect(() => {
		try {
			localStorage.setItem('runs-per-page', String(perPage));
		} catch {
			/* ni pomembno */
		}
	});
	const q = useQuery(api.runs.page, () => ({ offset: (page - 1) * perPage, size: perPage }));
	const total = $derived(q.data?.total ?? 0);
	// ostani na strani, ki obstaja (npr. po izbrisu runa)
	$effect(() => {
		const last = Math.max(1, Math.ceil(total / perPage));
		if (q.data && page > last) page = last;
	});
	function top() {
		if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
	}
</script>

<svelte:head><title>Dungeon Runs — WowCompany</title></svelte:head>

<div class="space-y-6">
	<PageHeader
		title="Dungeon Runs"
		icon={Swords}
		lead="Every dungeon the party survived — or didn't. Recorded by the Companion app, uploaded by whoever was snitching, judged by everyone. Click a run for the full autopsy."
	>
		{#snippet actions()}
			<a href="/link#download" class="text-sm text-primary hover:underline"
				>Get the Companion app →</a
			>
		{/snippet}
	</PageHeader>

	{#if access.data && !access.data.runs}
		<Locked what="our dungeon runs (and the bodies we left behind)" />
	{:else if q.isLoading && !q.data}
		<div class="space-y-3">
			{#each [1, 2, 3] as i (i)}<div class="h-36 animate-pulse rounded-lg bg-muted"></div>{/each}
		</div>
	{:else if !total}
		<Card.Root class="flex flex-col items-center gap-3 p-10 text-center">
			<p class="text-5xl">🕯️</p>
			<p class="font-display text-xl text-primary">No runs yet</p>
			<p class="max-w-md text-sm text-muted-foreground">
				The dungeons are suspiciously quiet. Either nobody installed the Companion, or everyone died
				before the log started. Install it, type <code class="text-primary">/combatlog</code>, go
				get murdered properly.
			</p>
		</Card.Root>
	{:else}
		<Pager count={total} bind:perPage bind:page label="runs per page" />
		<div class="space-y-3">
			{#each q.data?.rows ?? [] as run (run.id)}
				<RunCard {run} />
			{/each}
		</div>
		<div onclickcapture={top} role="presentation">
			<Pager count={total} bind:perPage bind:page label="runs per page" />
		</div>
	{/if}
</div>
