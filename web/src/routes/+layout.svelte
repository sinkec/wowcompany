<script lang="ts">
	import Tip from '#lib/components/wow/Tip.svelte';
	import './layout.css';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '#lib/auth-client.js';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import UserMenu from '#lib/components/wow/UserMenu.svelte';
	import SocialLinks from '#lib/components/wow/SocialLinks.svelte';
	import MainNav from '#lib/components/layout/MainNav.svelte';
	import Brand from '#lib/components/layout/Brand.svelte';
	import ConfirmHost from '#lib/components/layout/ConfirmHost.svelte';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { brandName } from '#convex/lib/siteContent.js';
	import { GITHUB_URL } from '#lib/site.js';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	createSvelteAuthClient({ authClient, getServerState: () => data.authState });

	// Arhiv starih realmov: povezava samo za člane, ko arhiv obstaja
	const archives = useQuery(api.realms.list, { now: Date.now() });
	const site = useQuery(api.site.home, {});
	const team = $derived(site.data?.teamName || null);
	const brand = $derived(brandName(team));
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="48x48" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<title>{brand} — Heroes, Loot & Corpse Runs</title>
	<meta
		name="description"
		content="Tracking our WoW Forever heroes: levels, loot and spectacular deaths."
	/>
</svelte:head>

<Tooltip.Provider delayDuration={250}>
<header class="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
	<div class="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
		<Brand {team} />
		<MainNav archive={!!archives.data?.length} />

		<div class="ml-auto flex items-center gap-1.5">
			<Tip text="Source code on GitHub" side="bottom">
			<a
				href={GITHUB_URL}
				target="_blank"
				rel="noopener noreferrer"
				aria-label="GitHub"
				class="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
			>
				<svg viewBox="0 0 16 16" class="size-5" fill="currentColor" aria-hidden="true"
					><path
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
					/></svg
				>
			</a>
			</Tip>
			<UserMenu />
		</div>
	</div>
</header>

<main class="mx-auto max-w-6xl px-4 py-8">
	{@render children()}
</main>

<footer class="mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-muted-foreground/70">
	{#if site.data?.socials.length}
		<div class="mb-3 flex justify-center">
			<SocialLinks socials={site.data.socials} />
		</div>
	{/if}
	<p class="mb-1 font-display text-muted-foreground">
		{brand} · WoW Forever · est. by people who should be sleeping
	</p>
	<p>
		Non-commercial fan project for a bunch of friends. Not affiliated with Blizzard Entertainment.
	</p>
	<p>
		World of Warcraft is a trademark of Blizzard Entertainment. Your deaths, however, are entirely
		your own fault.
	</p>
	<p class="mt-2 space-x-3">
		<a href="/privacy" class="hover:text-foreground hover:underline">Privacy</a>
		<a href="/terms" class="hover:text-foreground hover:underline">Terms</a>
	</p>
</footer>

</Tooltip.Provider>

<Toaster theme="dark" richColors position="bottom-right" />
<ConfirmHost />
