<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import Skull from '@lucide/svelte/icons/skull';
	import { api } from '#convex/_generated/api.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
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
	import type { RosterEntry } from '#lib/types.js';
	import { weekSince } from '#lib/wow.js';
	import PageHeader from '#lib/components/wow/PageHeader.svelte';
	import Users from '@lucide/svelte/icons/users';

	const roster = useQuery(api.players.list, { since: weekSince() });
	const feed = useQuery(api.events.recent, { limit: 20 });
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
				return [p.displayName, sm?.className, sm?.race, sm?.guild, sm?.talentSpec].some((x) =>
					x?.toLowerCase().includes(q)
				);
			})
			.sort((a, b) => {
				if (sort === 'name') return a.displayName.localeCompare(b.displayName);
				if (sort === 'seen') return (b.summary?.lastLogin ?? 0) - (a.summary?.lastLogin ?? 0);
				return (
					(b.summary?.level ?? 0) - (a.summary?.level ?? 0) ||
					(b.summary?.experience ?? 0) - (a.summary?.experience ?? 0)
				);
			})
	);

	const pages = $derived(Math.max(1, Math.ceil(sorted.length / pageSize)));
	const pageIdx = $derived(Math.min(page, pages - 1));
	const pageRows = $derived(sorted.slice(pageIdx * pageSize, pageIdx * pageSize + pageSize));
	const go = (d: number) => (page = Math.max(0, Math.min(pages - 1, pageIdx + d)));
</script>

<svelte:head><title>Heroes — WowCompany</title></svelte:head>

<div class="space-y-8">
	<PageHeader
		title="Heroes"
		icon={Users}
		lead="Everyone in the company, sorted by how much they play instead of sleeping – and what the tavern says about them."
	/>

	{#if roster.isLoading}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each Array(3) as _, i (i)}<Skeleton class="h-44 rounded-lg" />{/each}
		</div>
	{:else if roster.error}
		<div class="wow-frame rounded-lg p-6 text-destructive">
			The server died. Again. ({roster.error.message})
		</div>
	{:else if players.length === 0}
		<div class="wow-frame flex flex-col items-center gap-3 rounded-lg p-12 text-center">
			<Skull class="size-12 text-primary/70" />
			<h2 class="section-title">No heroes yet</h2>
			<p class="text-muted-foreground">Even the Scourge has more friends than this.</p>
		</div>
	{:else}
		<!--
			Roster + Tavern Gossip: roster ima fiksno višino (2 × 2 kartici ali 8 vrstic), več junakov = listanje/iskanje.
			Gossip se raztegne točno na višino rosterja (absolutno pozicioniran znotraj stolpca) in ima lasten drsnik.
		-->
		<div class="grid gap-8 lg:grid-cols-[1fr_340px]">
			<!-- roster -->
			<section class="min-w-0 space-y-3" aria-label="Roster">
				<div class="flex h-9 items-center justify-between gap-2">
					<h2 class="section-title">
						The Roster <span class="text-base font-normal text-muted-foreground"
							>({players.length})</span
						>
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
								class="rounded p-1 {view === 'cards'
									? 'bg-accent text-foreground'
									: 'text-muted-foreground hover:text-foreground'}"
								aria-label="Cards"
								aria-pressed={view === 'cards'}
								title="Cards"
								onclick={() => setView('cards')}><LayoutGrid class="size-4" /></button
							>
							<button
								class="rounded p-1 {view === 'list'
									? 'bg-accent text-foreground'
									: 'text-muted-foreground hover:text-foreground'}"
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
						<Search
							class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							bind:value={query}
							oninput={() => (page = 0)}
							placeholder="Find a hero, class, spec or guild…"
							class="h-9 pl-8"
						/>
					</div>
					<div class="flex shrink-0 items-center gap-1">
						<button
							class="grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
							aria-label="Previous heroes"
							disabled={pageIdx === 0}
							onclick={() => go(-1)}><ChevronLeft class="size-4" /></button
						>
						<span
							class="w-[5.5rem] text-center text-xs text-muted-foreground tabular-nums"
							aria-live="polite"
						>
							{#if sorted.length}{pageIdx * pageSize + 1}–{Math.min(
									sorted.length,
									(pageIdx + 1) * pageSize
								)} of {sorted.length}{:else}0 of 0{/if}
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
						<p
							class="wow-frame grid h-full place-items-center rounded-lg p-6 text-center text-sm text-muted-foreground italic"
						>
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
						<h2 class="section-title">Tavern Gossip</h2>
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
	{/if}
</div>
