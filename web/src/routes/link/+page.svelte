<script lang="ts">
	import { page } from '$app/state';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { toast } from 'svelte-sonner';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import Loader from '@lucide/svelte/icons/loader-2';
	import { api } from '#convex/_generated/api.js';
	import { authClient } from '#lib/auth-client.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import DevicesList from '#lib/components/wow/DevicesList.svelte';
	import GetApp from '#lib/components/wow/GetApp.svelte';

	const auth = useAuth();
	const client = useConvexClient();

	const code = $derived((page.url.searchParams.get('code') ?? '').trim().toUpperCase());
	// poizvedbe ne berejo ure -> čas pošlje brskalnik (osveži se ob vsakem nalaganju strani)
	const now = Date.now();

	const me = useQuery(api.claims.mine, () => (auth.isAuthenticated ? {} : 'skip'));
	const link = useQuery(api.companion.linkInfo, () =>
		auth.isAuthenticated && code ? { code, now } : 'skip'
	);

	const isMember = $derived(me.data?.role === 'admin' || me.data?.role === 'member');
	let busy = $state(false);
	let decided = $state<'approved' | 'denied' | null>(null);

	async function decide(approve: boolean) {
		busy = true;
		try {
			await client.mutation(api.companion.decideLink, { code, approve });
			decided = approve ? 'approved' : 'denied';
			if (approve)
				toast.success('Device linked', {
					description: 'Go back to the app. It already knows. Creepy, right?'
				});
			else
				toast('Link denied', { description: 'Whoever that was, they can go back to the Barrens.' });
		} catch (e) {
			toast.error((e as Error).message.replace(/^.*ConvexError:\s*/, '').replace(/\s+at .*$/s, ''));
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Companion App — WowCompany</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-8">
	<section class="space-y-2">
		<h1 class="text-3xl font-bold text-primary md:text-4xl">WowCompany Companion</h1>
		<p class="text-muted-foreground">
			The desktop app reads your combat log, judges your dungeon runs and snitches to the portal.
			Link it to your account here. Members only — strangers can watch their own deaths in private.
		</p>
	</section>

	<!-- pri povezovanju (koda v URL-ju) je prenos odveč – aplikacija že teče -->
	{#if !code}<GetApp />{/if}

	{#if auth.isLoading}
		<div class="h-40 animate-pulse rounded-lg bg-muted"></div>
	{:else if !auth.isAuthenticated}
		<div class="wow-frame flex flex-col items-center gap-4 rounded-lg p-10 text-center">
			<MonitorSmartphone class="size-10 text-primary/70" />
			<p>Sign in first. The app needs to know whose corpse it's uploading.</p>
			<Button
				onclick={() =>
					authClient.signIn.social({
						provider: 'google',
						callbackURL: code ? `/link?code=${encodeURIComponent(code)}` : '/link'
					})}>Sign in with Google</Button
			>
		</div>
	{:else}
		{#if code}
			<section class="wow-frame space-y-4 rounded-lg p-6">
				{#if link.isLoading || me.isLoading}
					<div class="flex items-center gap-2 text-muted-foreground">
						<Loader class="size-4 animate-spin" /> Consulting the spirits…
					</div>
				{:else if !isMember}
					<p class="text-destructive">
						Members only. <a href="/join" class="underline">Petition the Guild Master</a> first, then
						come back.
					</p>
				{:else if !link.data}
					<p>
						No such code: <span class="font-mono">{code}</span>. Typo, or the murloc ate it. Get a
						fresh one from the app.
					</p>
				{:else if decided === 'approved' || link.data.status === 'claimed' || link.data.status === 'approved'}
					<p class="text-lg">
						✅ <span class="font-semibold">{link.data.deviceName}</span> is linked. Go back to the app
						— it should say hi in a few seconds.
					</p>
				{:else if decided === 'denied' || link.data.status === 'denied'}
					<p>🚫 Denied. That device will get nothing but disappointment.</p>
				{:else if link.data.expired}
					<p>
						This code expired (10 min). Like your Well Fed buff. Start the link again in the app.
					</p>
				{:else}
					<div class="space-y-1">
						<div class="text-sm text-muted-foreground">
							Code <span class="font-mono text-foreground">{code}</span>
						</div>
						<p class="text-lg">
							Link <span class="font-semibold text-primary">{link.data.deviceName}</span>
							{#if link.data.appVersion}<span class="text-sm text-muted-foreground"
									>(v{link.data.appVersion})</span
								>{/if}
							to your account?
						</p>
						<p class="text-sm text-muted-foreground">
							Only approve if the same code is showing in <em>your</em> app right now. Otherwise someone
							is trying to upload runs as you — and probably dying a lot.
						</p>
					</div>
					<div class="flex gap-3">
						<Button disabled={busy} onclick={() => decide(true)}>
							{#if busy}<Loader class="size-4 animate-spin" />{/if} Approve
						</Button>
						<Button variant="outline" disabled={busy} onclick={() => decide(false)}>Deny</Button>
					</div>
				{/if}
			</section>
		{/if}

		<section class="space-y-3">
			<h2 class="text-xl font-semibold">My devices</h2>
			<DevicesList />
		</section>
	{/if}
</div>
