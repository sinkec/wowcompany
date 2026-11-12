<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import Crown from '@lucide/svelte/icons/crown';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import { api } from '#convex/_generated/api.js';
	import { authClient } from '#lib/auth-client.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';

	const auth = useAuth();
	const me = useQuery(api.auth.me, () => (auth.isAuthenticated ? {} : 'skip'));
	const claims = useQuery(api.claims.listForAdmin, () => (me.data?.role === 'admin' ? {} : 'skip'));
	const pending = $derived(claims.data?.pending.length ?? 0);

	let busy = $state(false);
	async function signIn() {
		busy = true;
		const { error } = await authClient.signIn.social({ provider: 'google', callbackURL: '/' });
		if (error) {
			busy = false;
			toast.error('Google said no.', { description: error.message });
		}
	}
	async function signOut() {
		await authClient.signOut();
		toast('Logged out. The tavern already forgot your name.');
	}

	const roleLabel = (r: string | null | undefined) =>
		r === 'admin' ? 'Guild Master' : r === 'member' ? 'Vouched Member' : 'Suspicious Stranger';
</script>

<nav class="flex items-center gap-1 text-sm">
	<a href="/join" class="rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">Join</a>
	{#if me.data?.role === 'admin'}
		<a href="/admin" class="relative flex items-center gap-1 rounded-md px-2.5 py-1 text-primary hover:bg-accent">
			<Crown class="size-4" /> Office
			{#if pending}<span class="grid size-5 place-items-center rounded-full bg-destructive text-[11px] font-bold text-white">{pending}</span>{/if}
		</a>
	{/if}
</nav>

{#if auth.isLoading}
	<div class="h-8 w-24 animate-pulse rounded-md bg-muted"></div>
{:else if !auth.isAuthenticated}
	<Button size="sm" onclick={signIn} disabled={busy}>{busy ? 'Summoning Google…' : 'Sign in'}</Button>
{:else}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<button {...props} class="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-accent">
					{#if me.data?.image}
						<img src={me.data.image} alt="" class="size-7 rounded-full" referrerpolicy="no-referrer" />
					{:else}
						<div class="grid size-7 place-items-center rounded-full bg-muted text-xs">{me.data?.name?.[0] ?? '?'}</div>
					{/if}
					<span class="hidden max-w-32 truncate text-sm sm:inline">{me.data?.name ?? '…'}</span>
					{#if me.data?.role === 'admin'}<Crown class="size-4 text-primary" />{/if}
				</button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-56">
			<DropdownMenu.Label>
				<div class="truncate">{me.data?.name}</div>
				<div class="truncate text-xs font-normal text-muted-foreground">{me.data?.email}</div>
				<div class="mt-1 text-xs font-normal text-primary">{roleLabel(me.data?.role)}</div>
			</DropdownMenu.Label>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onclick={() => goto('/join')}><ScrollText class="size-4" /> My petitions</DropdownMenu.Item>
			{#if me.data?.role === 'admin'}
				<DropdownMenu.Item onclick={() => goto('/admin')}><Crown class="size-4" /> Guild Master's Office</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Item onclick={signOut}><LogOut class="size-4" /> Log out (coward)</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
