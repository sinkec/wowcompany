<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
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
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { TableSort, type SortValue } from '#lib/sort.svelte.js';
	import type { RosterKey } from '#lib/components/wow/RosterTable.svelte';
	import PageHeader from '#lib/components/wow/PageHeader.svelte';
	import Users from '@lucide/svelte/icons/users';

	const roster = useQuery(api.players.list, { since: weekSince() });
	const feed = useQuery(api.events.recent, { limit: 20 });
	// en sort za oba pogleda: glava tabele (seznam) ali preklopnik (kartice); listanje po sortiranju
	const sort = new TableSort<RosterKey>('level');
	const rosterValue: Record<RosterKey, (c: RosterEntry) => SortValue> = {
		name: (c) => c.displayName,
		// enaka raven: več izkušenj višje
		level: (c) => (c.summary?.level ?? 0) * 1e9 + (c.summary?.experience ?? 0),
		talents: (c) => c.summary?.talentSpec,
		ilvl: (c) => c.summary?.ilvlEquipped,
		kills: (c) => c.summary?.kills,
		deaths: (c) => c.summary?.deaths,
		seen: (c) => c.summary?.lastLogin
	};

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
		sort.apply(players, rosterValue).filter((p) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			const sm = p.summary;
			return [p.displayName, sm?.className, sm?.race, sm?.guild, sm?.talentSpec].some((x) =>
				x?.toLowerCase().includes(q)
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
		<Card.Root class="p-6 text-destructive">
			The server died. Again. ({roster.error.message})
		</Card.Root>
	{:else if players.length === 0}
		<Card.Root class="flex flex-col items-center gap-3 p-12 text-center">
			<Skull class="size-12 text-primary/70" />
			<h2 class="section-title">No heroes yet</h2>
			<p class="text-muted-foreground">Even the Scourge has more friends than this.</p>
		</Card.Root>
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
						{#if view === 'cards'}
							<ToggleGroup.Root
								type="single"
								size="sm"
								class="hidden sm:flex"
								aria-label="Sort"
								bind:value={
									() => sort.key ?? '',
									(v) => {
										if (!v) return;
										sort.set(v as RosterKey, v === 'name' ? 'asc' : 'desc');
										page = 0;
									}
								}
							>
								<ToggleGroup.Item value="level">level</ToggleGroup.Item>
								<ToggleGroup.Item value="seen">last seen</ToggleGroup.Item>
								<ToggleGroup.Item value="name">name</ToggleGroup.Item>
							</ToggleGroup.Root>
						{/if}
						<ToggleGroup.Root
							type="single"
							variant="outline"
							size="sm"
							aria-label="View"
							bind:value={() => view, (v) => v && setView(v as View)}
						>
							<ToggleGroup.Item value="cards" aria-label="Cards"
								><LayoutGrid class="size-4" /></ToggleGroup.Item
							>
							<ToggleGroup.Item value="list" aria-label="List"
								><List class="size-4" /></ToggleGroup.Item
							>
						</ToggleGroup.Root>
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
						<Button
							variant="outline"
							size="icon"
							aria-label="Previous heroes"
							disabled={pageIdx === 0}
							onclick={() => go(-1)}><ChevronLeft class="size-4" /></Button
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
						<Button
							variant="outline"
							size="icon"
							aria-label="Next heroes"
							disabled={pageIdx >= pages - 1}
							onclick={() => go(1)}><ChevronRight class="size-4" /></Button
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
						<RosterTable rows={pageRows} {allowed} {sort} onsort={() => (page = 0)} />
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
