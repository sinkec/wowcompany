<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { toast } from 'svelte-sonner';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Loader from '@lucide/svelte/icons/loader-2';
	import { api } from '#convex/_generated/api.js';
	import { authClient } from '#lib/auth-client.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { ago, classColor } from '#lib/wow.js';

	const auth = useAuth();
	const client = useConvexClient();
	const mine = useQuery(api.claims.mine, () => (auth.isAuthenticated ? {} : 'skip'));
	const roster = useQuery(api.roster.members, () => (auth.isAuthenticated ? {} : 'skip'));

	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	let focused = $state(false);

	const suggestions = $derived.by(() => {
		const q = name.trim().toLowerCase();
		if (q.length < 2 || !roster.data) return [];
		return roster.data
			.filter((m) => `${m.name} ${m.surname}`.toLowerCase().includes(q))
			.sort((a, b) => b.level - a.level)
			.slice(0, 6);
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy || name.trim().length < 3) return;
		busy = true;
		error = '';
		try {
			const r = await client.action(api.claims.submit, { name });
			if (r.ok) {
				toast.success(`Petition for ${r.name} sent`, {
					description: `Level ${r.preview.level} ${r.preview.race} ${r.preview.className}. Now grovel and wait.`
				});
				name = '';
			} else error = r.error;
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	const STATUS = {
		pending: { label: 'Awaiting judgment', variant: 'secondary' },
		accepted: { label: 'Welcome, sucker', variant: 'default' },
		rejected: { label: 'Denied. Ouch.', variant: 'destructive' }
	} as const;
</script>

<svelte:head><title>Join the Company — WowCompany</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-8">
	<section class="space-y-2">
		<h1 class="text-3xl font-bold text-primary md:text-4xl">Petition the Guild Master</h1>
		<p class="text-muted-foreground">
			Want your hero tracked, judged and publicly shamed? Tell us who you are. The Guild Master will review your petition
			while pretending to be busy.
		</p>
	</section>

	{#if auth.isLoading}
		<div class="h-40 animate-pulse rounded-lg bg-muted"></div>
	{:else if !auth.isAuthenticated}
		<div class="wow-frame flex flex-col items-center gap-4 rounded-lg p-10 text-center">
			<ScrollText class="size-10 text-primary/70" />
			<p>Sign in first. We need to know who to blame.</p>
			<Button onclick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/join' })}>Sign in with Google</Button>
		</div>
	{:else}
		{#if mine.data?.role}
			<p class="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
				You're already in ({mine.data.role === 'admin' ? 'Guild Master, obviously' : 'vouched member'}). Got alts? Add them
				too, we don't judge. (We do.)
			</p>
		{/if}

		<form onsubmit={submit} class="wow-frame space-y-3 rounded-lg p-5">
			<label for="hero" class="text-sm font-semibold text-primary">Your hero's full name</label>
			<div class="relative">
				<Input
					id="hero"
					bind:value={name}
					placeholder="Firstname Surname"
					autocomplete="off"
					disabled={busy}
					aria-invalid={!!error}
					onfocus={() => (focused = true)}
					onblur={() => setTimeout(() => (focused = false), 150)}
				/>
				{#if focused && suggestions.length}
					<ul class="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
						{#each suggestions as m (m.slug)}
							<li>
								<button
									type="button"
									class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
									onclick={() => (name = `${m.name} ${m.surname}`)}
								>
									<span style="color: {classColor(m.classId)}">{m.name} {m.surname}</span>
									<span class="text-xs text-muted-foreground">lvl {m.level}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<p class="text-xs text-muted-foreground">
				Exactly as in game. Must be level 10+ and logged out at least once, or Blizzard pretends you don't exist.
			</p>
			{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
			<Button type="submit" disabled={busy || name.trim().length < 3}>
				{#if busy}<Loader class="size-4 animate-spin" /> Asking Blizzard…{:else}Send petition{/if}
			</Button>
		</form>

		<section class="space-y-3">
			<h2 class="text-xl font-semibold">Your petitions</h2>
			{#if !mine.data?.claims.length}
				<p class="text-sm text-muted-foreground italic">None yet. Shy, are we?</p>
			{:else}
				<ul class="space-y-2">
					{#each mine.data.claims as c (c.id)}
						<li class="wow-frame flex items-center justify-between gap-3 rounded-lg p-3">
							<div class="min-w-0">
								<div class="truncate font-semibold" style="color: {classColor(c.preview.classId)}">{c.name}</div>
								<div class="text-xs text-muted-foreground">
									Level {c.preview.level} {c.preview.race} {c.preview.className} · sent {ago(c.createdAt)}
								</div>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
								{#if c.status === 'accepted'}<a href="/c/{c.slug}" class="text-sm text-primary hover:underline">view</a>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
