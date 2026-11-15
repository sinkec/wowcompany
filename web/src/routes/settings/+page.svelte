<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { toast } from 'svelte-sonner';
	import Loader from '@lucide/svelte/icons/loader-2';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import Shield from '@lucide/svelte/icons/shield';
	import Star from '@lucide/svelte/icons/star';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import UserRound from '@lucide/svelte/icons/user-round';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { authClient } from '#lib/auth-client.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import DevicesList from '#lib/components/wow/DevicesList.svelte';
	import { ago, classColor } from '#lib/wow.js';

	const auth = useAuth();
	const client = useConvexClient();
	const q = useQuery(api.profile.mine, () => (auth.isAuthenticated ? {} : 'skip'));
	const me = $derived(q.data);

	const SECTIONS = [
		{ key: 'profile', label: 'Profile', icon: UserRound, hint: 'Name & main hero' },
		{ key: 'characters', label: 'Characters', icon: Shield, hint: 'Your main and the alt army' },
		{
			key: 'devices',
			label: 'Companion devices',
			icon: MonitorSmartphone,
			hint: 'PCs that snitch your runs'
		},
		{ key: 'account', label: 'Account', icon: UserCog, hint: 'Email, role, the exit' }
	] as const;
	type Key = (typeof SECTIONS)[number]['key'];
	const tab = $derived<Key>(
		(SECTIONS.find((s) => s.key === page.url.searchParams.get('tab'))?.key ?? 'profile') as Key
	);
	const go = (k: Key) => goto(`/settings${k === 'profile' ? '' : `?tab=${k}`}`, { replace: true });

	// ---------------- profile
	let firstName = $state('');
	let lastName = $state('');
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		// izpolni obrazec enkrat, ko pridejo podatki (ne prepiši, kar uporabnik tipka)
		if (me && loadedFor !== me.email) {
			firstName = me.profile.firstName;
			lastName = me.profile.lastName;
			loadedFor = me.email;
		}
	});
	const nameDirty = $derived(
		!!me && (firstName.trim() !== me.profile.firstName || lastName.trim() !== me.profile.lastName)
	);
	let savingName = $state(false);
	async function saveName(e: SubmitEvent) {
		e.preventDefault();
		savingName = true;
		try {
			await client.mutation(api.profile.updateName, { firstName, lastName });
			toast.success('Name saved', { description: 'The bards will mispronounce it anyway.' });
		} catch (err) {
			toast.error(msg(err));
		} finally {
			savingName = false;
		}
	}

	// ---------------- characters
	const msg = (e: unknown) =>
		(e as Error).message
			.replace(/^.*ConvexError:\s*/, '')
			.replace(/\s+at .*$/s, '')
			.replace(/^Uncaught Error:\s*/, '');
	async function setMain(id: Id<'players'>, name: string) {
		try {
			await client.mutation(api.profile.setMain, { playerId: id });
			toast.success(`${name} is your main now`, {
				description: 'The alts have been informed. They are sad.'
			});
		} catch (e) {
			toast.error(msg(e));
		}
	}
	async function disown(id: Id<'players'>, name: string) {
		if (!confirm(`Disown ${name}? The hero stays on the portal, just not under your name.`)) return;
		try {
			await client.mutation(api.profile.disown, { playerId: id });
			toast(`${name} disowned`, { description: 'Abandoned like a quest at 9/10 boar livers.' });
		} catch (e) {
			toast.error(msg(e));
		}
	}
	async function remove(id: Id<'players'>, name: string) {
		const typed = prompt(
			`Remove ${name} from WowCompany? Stats, history and the Tavern Gossip about them are deleted for good.\n\nType "${name}" to confirm:`
		);
		if (typed === null) return;
		try {
			await client.mutation(api.profile.removeCharacter, { playerId: id, confirmName: typed });
			toast(`${name} has been erased`, {
				description: 'Not even a corpse run will bring them back.'
			});
		} catch (e) {
			toast.error(msg(e));
		}
	}

	let altName = $state('');
	let addingAlt = $state(false);
	async function addAlt(e: SubmitEvent) {
		e.preventDefault();
		if (altName.trim().length < 3) return;
		addingAlt = true;
		try {
			const r = await client.action(api.claims.submit, { name: altName });
			if (r.ok) {
				toast.success(`Petition for ${r.name} sent`, {
					description: `Level ${r.preview.level} ${r.preview.race} ${r.preview.className}. The Guild Master will stamp it eventually.`
				});
				altName = '';
			} else toast.error(r.error);
		} catch (err) {
			toast.error(msg(err));
		} finally {
			addingAlt = false;
		}
	}
	async function cancelPetition(id: Id<'claims'>) {
		try {
			await client.mutation(api.profile.cancelPetition, { claimId: id });
			toast('Petition withdrawn. Cold feet?');
		} catch (e) {
			toast.error(msg(e));
		}
	}

	async function signOut() {
		await authClient.signOut();
		toast('Logged out. The tavern already forgot your name.');
		goto('/');
	}

	const ROLE = { admin: 'Guild Master', member: 'Vouched member' } as const;
</script>

<svelte:head><title>Settings — WowCompany</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold text-primary md:text-4xl">Your Quarters</h1>
		<p class="text-muted-foreground">
			Rename yourself, herd your alts, exile your devices. Self-care, WoW style.
		</p>
	</div>

	{#if auth.isLoading || (auth.isAuthenticated && q.isLoading)}
		<div class="h-64 animate-pulse rounded-lg bg-muted"></div>
	{:else if !auth.isAuthenticated || !me}
		<div class="wow-frame flex flex-col items-center gap-4 rounded-lg p-10 text-center">
			<UserCog class="size-10 text-primary/70" />
			<p>Sign in first. We can't let strangers rename themselves into someone else.</p>
			<Button
				onclick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/settings' })}
				>Sign in with Google</Button
			>
		</div>
	{:else}
		<div class="grid gap-6 md:grid-cols-[14rem_1fr]">
			<!-- sub-nav -->
			<nav class="flex gap-1 overflow-x-auto md:flex-col" aria-label="Settings sections">
				{#each SECTIONS as s (s.key)}
					<button
						onclick={() => go(s.key)}
						aria-current={tab === s.key ? 'page' : undefined}
						class="flex min-h-11 shrink-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors {tab ===
						s.key
							? 'bg-accent/70 text-foreground md:border-l-2 md:border-primary'
							: 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
					>
						<s.icon class="size-4 shrink-0 {tab === s.key ? 'text-primary' : ''}" />
						<span>
							<span class="block font-medium">{s.label}</span>
							<span class="hidden text-xs text-muted-foreground md:block">{s.hint}</span>
						</span>
					</button>
				{/each}
			</nav>

			<div class="min-w-0 space-y-6">
				{#if tab === 'profile'}
					<form onsubmit={saveName} class="wow-frame space-y-4 rounded-lg p-5">
						<div>
							<h2 class="font-display text-xl font-semibold text-primary">What do we call you?</h2>
							<p class="text-sm text-muted-foreground">
								Your real-ish name, shown in the menu and to the Guild Master. Your heroes keep
								their own names.
							</p>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<label class="space-y-1.5 text-sm">
								<span class="font-medium">First name</span>
								<Input bind:value={firstName} maxlength={40} autocomplete="given-name" required />
							</label>
							<label class="space-y-1.5 text-sm">
								<span class="font-medium">Last name</span>
								<Input bind:value={lastName} maxlength={40} autocomplete="family-name" />
							</label>
						</div>
						<div class="flex flex-wrap items-center gap-3">
							<Button type="submit" disabled={!nameDirty || savingName || !firstName.trim()}>
								{#if savingName}<Loader class="size-4 animate-spin" />{/if} Save name
							</Button>
							<span class="text-xs text-muted-foreground">
								Shown as <b class="text-foreground">{`${firstName} ${lastName}`.trim() || '…'}</b>
								{#if !me.profile.saved}· currently using your Google name{/if}
							</span>
						</div>
					</form>

					<section class="wow-frame space-y-3 rounded-lg p-5">
						<div>
							<h2 class="font-display text-xl font-semibold text-primary">Main hero</h2>
							<p class="text-sm text-muted-foreground">
								The one you're proud of. Shown next to your name. The others are “alts”, i.e.
								regrets.
							</p>
						</div>
						{#if !me.characters.length}
							<p class="text-sm text-muted-foreground italic">
								No heroes yet. <button
									class="text-primary hover:underline"
									onclick={() => go('characters')}>Add one</button
								>.
							</p>
						{:else}
							<div class="flex flex-wrap gap-2">
								{#each me.characters as c (c.id)}
									{@const isMain = me.profile.mainSlug === c.slug}
									<button
										onclick={() => !isMain && setMain(c.id, c.name)}
										class="flex min-h-11 items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors {isMain
											? 'border-primary bg-primary/10'
											: 'border-border hover:border-primary/60'}"
									>
										{#if isMain}<Star class="size-4 fill-primary text-primary" />{/if}
										<span style="color: {classColor(c.classId ?? undefined)}">{c.name}</span>
										{#if c.level}<span class="text-xs text-muted-foreground">{c.level}</span>{/if}
									</button>
								{/each}
							</div>
						{/if}
					</section>
				{:else if tab === 'characters'}
					<section class="space-y-3">
						<div class="flex flex-wrap items-end justify-between gap-2">
							<div>
								<h2 class="font-display text-xl font-semibold text-primary">Your heroes</h2>
								<p class="text-sm text-muted-foreground">
									{me.characters.length
										? `${me.characters.length} hero${me.characters.length === 1 ? '' : 'es'} under your name. That's ${me.characters.length > 3 ? 'a problem' : 'fine'}.`
										: 'None yet. The company is waiting.'}
								</p>
							</div>
						</div>
						{#each me.characters as c (c.id)}
							{@const isMain = me.profile.mainSlug === c.slug}
							<div class="wow-frame flex flex-wrap items-center gap-4 rounded-lg p-4">
								{#if c.avatar}
									<img
										src={c.avatar}
										alt=""
										class="size-12 rounded-full border-2"
										style="border-color: {classColor(c.classId ?? undefined)}"
									/>
								{:else}
									<div class="grid size-12 place-items-center rounded-full bg-muted text-lg">?</div>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<a
											href="/c/{c.slug}"
											class="font-display text-lg font-semibold hover:underline"
											style="color: {classColor(c.classId ?? undefined)}">{c.name}</a
										>
										{#if isMain}<Badge><Star class="size-3 fill-current" /> Main</Badge
											>{:else}<Badge variant="secondary">Alt</Badge>{/if}
										{#if !c.active}<Badge variant="destructive">Not tracked</Badge>{/if}
									</div>
									<div class="text-sm text-muted-foreground">
										{#if c.level}Level {c.level} {c.race} {c.className}{:else}Waiting for Blizzard
											to cough up data…{/if}
										{#if c.ilvl}· ilvl {c.ilvl}{/if}
										{#if c.lastLogin}· seen {ago(c.lastLogin)}{/if}
									</div>
								</div>
								<div class="flex flex-wrap gap-2">
									{#if !isMain}<Button
											size="sm"
											variant="outline"
											onclick={() => setMain(c.id, c.name)}>Make main</Button
										>{/if}
									<Button size="sm" variant="ghost" onclick={() => disown(c.id, c.name)}
										>Disown</Button
									>
									<Button
										size="sm"
										variant="ghost"
										class="text-destructive hover:text-destructive"
										onclick={() => remove(c.id, c.name)}>Remove</Button
									>
								</div>
							</div>
						{/each}
					</section>

					<form onsubmit={addAlt} class="wow-frame space-y-3 rounded-lg p-5">
						<div>
							<h2 class="font-display text-xl font-semibold text-primary">Add an alt</h2>
							<p class="text-sm text-muted-foreground">
								Full name exactly as in game. The Guild Master approves it — paperwork builds
								character.
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<Input
								bind:value={altName}
								placeholder="Firstname Surname"
								class="max-w-sm"
								disabled={addingAlt}
							/>
							<Button type="submit" disabled={addingAlt || altName.trim().length < 3}>
								{#if addingAlt}<Loader class="size-4 animate-spin" /> Asking Blizzard…{:else}Send
									petition{/if}
							</Button>
						</div>
						{#if me.petitions.length}
							<ul class="space-y-1.5 pt-2">
								{#each me.petitions as p (p.id)}
									<li class="flex flex-wrap items-center gap-2 text-sm">
										<span style="color: {classColor(p.preview.classId)}">{p.name}</span>
										<span class="text-xs text-muted-foreground"
											>lvl {p.preview.level} {p.preview.className} · {ago(p.createdAt)}</span
										>
										{#if p.status === 'pending'}
											<Badge variant="secondary">Awaiting judgment</Badge>
											<button
												class="text-xs text-muted-foreground hover:text-destructive hover:underline"
												onclick={() => cancelPetition(p.id)}>withdraw</button
											>
										{:else}
											<Badge variant="destructive">Denied. Ouch.</Badge>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</form>
				{:else if tab === 'devices'}
					<section class="wow-frame space-y-4 rounded-lg p-5">
						<div class="flex flex-wrap items-end justify-between gap-2">
							<div>
								<h2 class="font-display text-xl font-semibold text-primary">Companion devices</h2>
								<p class="text-sm text-muted-foreground">
									PCs running the Companion app under your name. Lost a laptop? Revoke it before it
									uploads your shame.
								</p>
							</div>
							<a href="/link#download" class="text-sm text-primary hover:underline"
								>Download & link the app →</a
							>
						</div>
						<DevicesList />
					</section>
				{:else}
					<section class="wow-frame space-y-4 rounded-lg p-5">
						<h2 class="font-display text-xl font-semibold text-primary">Account</h2>
						<dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
							<dt class="text-muted-foreground">Signed in as</dt>
							<dd class="flex items-center gap-2">
								{#if me.image}<img
										src={me.image}
										alt=""
										class="size-6 rounded-full"
										referrerpolicy="no-referrer"
									/>{/if}
								{me.email} <span class="text-xs text-muted-foreground">(Google)</span>
							</dd>
							<dt class="text-muted-foreground">Rank</dt>
							<dd>{me.role ? ROLE[me.role] : 'Suspicious stranger'}</dd>
							{#if me.memberSince}
								<dt class="text-muted-foreground">Account created</dt>
								<dd>{ago(me.memberSince)}</dd>
							{/if}
						</dl>
						<p class="text-xs text-muted-foreground">
							Email and avatar come from Google — change them there. Want everything deleted? Ask
							the Guild Master; see
							<a href="/privacy" class="text-primary hover:underline">Privacy</a>.
						</p>
						<Button variant="outline" onclick={signOut}>Log out</Button>
					</section>
				{/if}
			</div>
		</div>
	{/if}
</div>
