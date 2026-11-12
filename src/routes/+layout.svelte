<script lang="ts">
	import './layout.css';
	import Swords from '@lucide/svelte/icons/swords';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '#lib/auth-client.js';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import UserMenu from '#lib/components/wow/UserMenu.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	createSvelteAuthClient({ authClient, getServerState: () => data.authState });

	const favicon =
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9A%94%EF%B8%8F%3C/text%3E%3C/svg%3E";
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>WowCompany — Heroes, Loot & Corpse Runs</title>
	<meta name="description" content="Tracking our WoW Forever heroes: levels, loot and spectacular deaths." />
</svelte:head>

<header class="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur">
	<div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
		<a href="/" class="flex items-center gap-2 font-display text-lg font-bold text-primary">
			<Swords class="size-5" /> WowCompany
		</a>
		<span class="hidden text-xs text-muted-foreground italic sm:inline">est. by people who should be sleeping</span>
		<span class="ml-auto hidden text-xs text-muted-foreground md:inline">WoW Forever · EU · Horde-ish</span>
		<div class="ml-auto flex items-center gap-2 md:ml-3"><UserMenu /></div>
	</div>
</header>

<main class="mx-auto max-w-6xl px-4 py-8">
	{@render children()}
</main>

<footer class="mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-muted-foreground/70">
	<p>Non-commercial fan project for a bunch of friends. Not affiliated with Blizzard Entertainment.</p>
	<p>World of Warcraft is a trademark of Blizzard Entertainment. Your deaths, however, are entirely your own fault.</p>
</footer>

<Toaster theme="dark" richColors position="bottom-right" />
