<script lang="ts">
	// Glavni meni po kategorijah: Home · Company ▾ (junaki, lestvice, arhiv) · Dungeons ▾ (runi,
	// rankings) · Calendar. Skupina je aktivna, ko je aktivna katerakoli njena stran.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import House from '@lucide/svelte/icons/house';
	import Users from '@lucide/svelte/icons/users';
	import Swords from '@lucide/svelte/icons/swords';
	import Trophy from '@lucide/svelte/icons/trophy';
	import Medal from '@lucide/svelte/icons/medal';
	import Archive from '@lucide/svelte/icons/archive';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';

	let { archive = false }: { archive?: boolean } = $props();

	type Link = {
		href: string;
		label: string;
		note?: string;
		icon: typeof House;
		match: (p: string) => boolean;
	};
	type Entry = Link | { label: string; icon: typeof House; items: Link[] };

	const entries = $derived<Entry[]>([
		{ href: '/', label: 'Home', icon: House, match: (p) => p === '/' },
		{
			label: 'Company',
			icon: Users,
			items: [
				{
					href: '/heroes',
					label: 'Heroes',
					note: 'the roster and the tavern gossip',
					icon: Users,
					match: (p) => p.startsWith('/heroes') || p.startsWith('/c/')
				},
				{
					href: '/leaderboards',
					label: 'Leaderboards',
					note: 'glory, shame and party composition',
					icon: Medal,
					match: (p) => p.startsWith('/leaderboards')
				},
				...(archive
					? [
							{
								href: '/archive',
								label: 'Archive',
								note: 'the realm we left behind',
								icon: Archive,
								match: (p: string) => p.startsWith('/archive')
							}
						]
					: [])
			]
		},
		{
			label: 'Dungeons',
			icon: Swords,
			items: [
				{
					href: '/runs',
					label: 'Dungeon runs',
					note: 'every run, replay and corpse',
					icon: ScrollText,
					match: (p) => p.startsWith('/runs')
				},
				{
					href: '/rankings',
					label: 'Rankings',
					note: 'company parses, boss by boss',
					icon: Trophy,
					match: (p) => p.startsWith('/rankings')
				}
			]
		},
		{
			href: '/calendar',
			label: 'Calendar',
			icon: CalendarDays,
			match: (p) => p.startsWith('/calendar')
		}
	]);

	const path = $derived(page.url.pathname);
	const isActive = (e: Entry) =>
		'items' in e ? e.items.some((i) => i.match(path)) : e.match(path);
	const base =
		'relative inline-flex h-10 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors sm:px-3.5';
	const tone = (on: boolean) =>
		on
			? 'bg-accent/70 text-foreground'
			: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground';
</script>

<nav class="flex items-center gap-0.5 sm:gap-1" aria-label="Main">
	{#each entries as e (e.label)}
		{@const on = isActive(e)}
		{#if 'items' in e}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger class="{base} {tone(on)}" aria-current={on ? 'page' : undefined}>
					<e.icon class="size-4 {on ? 'text-primary' : ''}" />
					<span class="hidden md:inline">{e.label}</span>
					<ChevronDown class="hidden size-3.5 opacity-60 md:block" />
					{#if on}<span class="absolute inset-x-3 -bottom-[13px] h-0.5 rounded bg-primary"
						></span>{/if}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-64">
					{#each e.items as i (i.href)}
						<DropdownMenu.Item onSelect={() => goto(i.href)} class="items-start gap-3 py-2">
							<i.icon
								class="mt-0.5 size-4 {i.match(path) ? 'text-primary' : 'text-muted-foreground'}"
							/>
							<span class="flex flex-col">
								<span class="font-medium {i.match(path) ? 'text-primary' : ''}">{i.label}</span>
								{#if i.note}<span class="text-xs text-muted-foreground">{i.note}</span>{/if}
							</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{:else}
			<a href={e.href} aria-current={on ? 'page' : undefined} class="{base} {tone(on)}">
				<e.icon class="size-4 {on ? 'text-primary' : ''}" />
				<span class="hidden md:inline">{e.label}</span>
				{#if on}<span class="absolute inset-x-3 -bottom-[13px] h-0.5 rounded bg-primary"
					></span>{/if}
			</a>
		{/if}
	{/each}
</nav>
