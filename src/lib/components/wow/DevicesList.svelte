<script lang="ts">
	// "My devices" – povezane Companion aplikacije (uporablja /link in /settings).
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { ago } from '#lib/wow.js';

	const client = useConvexClient();
	const devices = useQuery(api.companion.myDevices, {});

	async function revoke(deviceId: Id<'devices'>, name: string) {
		if (!confirm(`Revoke "${name}"? It will stop uploading runs immediately.`)) return;
		try {
			await client.mutation(api.companion.revokeDevice, { deviceId });
			toast.success(`${name} revoked`, { description: 'Exiled. Hearthstone confiscated.' });
		} catch (e) {
			toast.error((e as Error).message);
		}
	}
</script>

{#if devices.isLoading}
	<div class="h-16 animate-pulse rounded-lg bg-muted"></div>
{:else if !devices.data?.length}
	<p class="text-sm text-muted-foreground italic">
		No devices yet. Install the Companion, click “Sign in with Google” in it, and it will send you
		to the portal.
	</p>
{:else}
	<ul class="space-y-2">
		{#each devices.data as d (d._id)}
			<li
				class="wow-frame flex items-center justify-between gap-3 rounded-lg p-3"
				class:opacity-50={d.revokedAt}
			>
				<div class="min-w-0">
					<div class="truncate font-semibold">{d.name}</div>
					<div class="text-xs text-muted-foreground">
						linked {ago(d.createdAt)}
						{#if d.lastSeenAt}· last upload {ago(d.lastSeenAt)}{:else}· never uploaded anything{/if}
						{#if d.appVersion}· v{d.appVersion}{/if}
					</div>
				</div>
				{#if d.revokedAt}
					<Badge variant="secondary">Revoked</Badge>
				{:else}
					<Button size="sm" variant="outline" onclick={() => revoke(d._id, d.name)}>Revoke</Button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
