<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import Crown from '@lucide/svelte/icons/crown';
	import LogOut from '@lucide/svelte/icons/log-out';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Shield from '@lucide/svelte/icons/shield';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import { api } from '#convex/_generated/api.js';
	import { authClient } from '#lib/auth-client.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { classColor } from '#lib/wow.js';

	const auth = useAuth();
	const me = useQuery(api.auth.me, () => (auth.isAuthenticated ? {} : 'skip'));
	const claims = useQuery(api.claims.listForAdmin, () => (me.data?.role === 'admin' ? {} : 'skip'));
	const pending = $derived(claims.data?.pending.length ?? 0);
	const isMember = $derived(me.data?.role === 'admin' || me.data?.role === 'member');

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
		goto('/');
	}

	const roleLabel = (r: string | null | undefined) =>
		r === 'admin' ? 'Guild Master' : r === 'member' ? 'Vouched Member' : 'Suspicious Stranger';
	const linkCls =
		'inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent/50';
</script>

{#if auth.isAuthenticated && me.data && !isMember}
	<a href="/join" class="{linkCls} text-primary">
		<ScrollText class="size-4" /><span class="hidden md:inline">Join</span>
	</a>
{:else if !auth.isLoading && !auth.isAuthenticated}
	<a
		href="/join"
		class="{linkCls} hidden text-muted-foreground hover:text-foreground sm:inline-flex">Join</a
	>
{/if}

{#if me.data?.role === 'admin'}
	<a href="/admin" class="{linkCls} relative text-primary" title="Guild Master's Office">
		<Crown class="size-4" /><span class="hidden md:inline">Office</span>
		{#if pending}<span
				class="grid size-5 place-items-center rounded-full bg-destructive text-[11px] font-bold text-white"
				>{pending}</span
			>{/if}
	</a>
{/if}

{#if auth.isLoading}
	<div class="h-10 w-24 animate-pulse rounded-md bg-muted"></div>
{:else if !auth.isAuthenticated}
	<Button class="h-10 px-4" onclick={signIn} disabled={busy}
		>{busy ? 'Summoning Google…' : 'Sign in'}</Button
	>
{:else}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					class="flex h-10 items-center gap-2 rounded-full border border-border/60 py-0.5 pr-3 pl-0.5 transition-colors hover:border-primary/60 hover:bg-accent/50"
					aria-label="Account menu"
				>
					{#if me.data?.image}
						<img
							src={me.data.image}
							alt=""
							class="size-8 rounded-full"
							referrerpolicy="no-referrer"
						/>
					{:else}
						<div class="grid size-8 place-items-center rounded-full bg-muted text-xs">
							{me.data?.name?.[0] ?? '?'}
						</div>
					{/if}
					<span class="hidden max-w-36 truncate text-sm sm:inline">{me.data?.name ?? '…'}</span>
					{#if me.data?.role === 'admin'}<Crown class="size-4 text-primary" />{/if}
				</button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-64">
			<DropdownMenu.Label>
				<div class="truncate">{me.data?.name}</div>
				<div class="truncate text-xs font-normal text-muted-foreground">{me.data?.email}</div>
				<div class="mt-1 flex items-center gap-1.5 text-xs font-normal">
					<span class="text-primary">{roleLabel(me.data?.role)}</span>
					{#if me.data?.main}
						<span class="text-muted-foreground">· main</span>
						<span class="truncate" style="color: {classColor(me.data.main.classId ?? undefined)}"
							>{me.data.main.name}</span
						>
					{/if}
				</div>
			</DropdownMenu.Label>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onclick={() => goto('/settings')}
				><UserCog class="size-4" /> Profile & settings</DropdownMenu.Item
			>
			<DropdownMenu.Item onclick={() => goto('/settings?tab=characters')}
				><Shield class="size-4" /> My characters</DropdownMenu.Item
			>
			<DropdownMenu.Item onclick={() => goto('/settings?tab=devices')}
				><MonitorSmartphone class="size-4" /> Companion devices</DropdownMenu.Item
			>
			{#if me.data?.role === 'admin'}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => goto('/admin')}
					><Crown class="size-4" /> Guild Master's Office</DropdownMenu.Item
				>
			{/if}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onclick={signOut}
				><LogOut class="size-4" /> Log out (coward)</DropdownMenu.Item
			>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
