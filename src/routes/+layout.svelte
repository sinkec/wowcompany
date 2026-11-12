<script lang="ts">
	import './layout.css';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '#lib/auth-client.js';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import UserMenu from '#lib/components/wow/UserMenu.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	createSvelteAuthClient({ authClient, getServerState: () => data.authState });

</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="48x48" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<title>WowCompany — Heroes, Loot & Corpse Runs</title>
	<meta name="description" content="Tracking our WoW Forever heroes: levels, loot and spectacular deaths." />
</svelte:head>

<header class="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur">
	<div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
		<a href="/" class="flex items-center gap-2 font-display text-lg font-bold text-primary">
			<img src="/icon.svg" alt="" class="size-7" /> WowCompany
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
	<p class="mt-2 space-x-3">
		<a href="/privacy" class="hover:text-foreground hover:underline">Privacy</a>
		<a href="/terms" class="hover:text-foreground hover:underline">Terms</a>
	</p>
</footer>

<Toaster theme="dark" richColors position="bottom-right" />
