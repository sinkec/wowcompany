<script lang="ts">
	// Ime ekipe pred "WowCompany" (glava strani, naslov zavihka, Discord noge).
	import { useConvexClient } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '#convex/_generated/api.js';
	import { brandName, cleanTeamName, MAX_TEAM } from '#convex/lib/siteContent.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { attempt } from '#lib/errors.js';

	let { current }: { current: string | null } = $props();
	const client = useConvexClient();
	let draft = $state<string | null>(null);
	const value = $derived(draft ?? current ?? '');
	const preview = $derived(cleanTeamName(value));

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const r = await attempt(client.mutation(api.site.saveTeamName, { teamName: value }));
		if (r) {
			draft = null;
			toast.success(`Renamed: ${r}. The banners are being re-stitched.`);
		}
	}
</script>

<section class="panel space-y-3">
	<div>
		<h3 class="card-title">Company name</h3>
		<p class="section-lead">
			Your crew's name goes above "WowCompany" in the header, in the browser tab and in Discord
			posts. Leave it empty for plain WowCompany.
		</p>
	</div>
	<form class="flex flex-wrap items-center gap-2" onsubmit={save}>
		<Input
			{value}
			oninput={(e) => (draft = e.currentTarget.value)}
			maxlength={MAX_TEAM + 12}
			placeholder="e.g. Ajmer Central"
			class="max-w-xs"
		/>
		<Button type="submit" disabled={preview === (current ?? '')}>Save</Button>
	</form>
	<!-- predogled glave -->
	<div class="flex items-center gap-2.5 rounded-md border border-border/60 bg-background/60 p-3">
		<img src="/icon.svg" alt="" class="size-9" />
		<span class="flex flex-col leading-none">
			{#if preview}<span
					class="text-[0.68rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase"
					>{preview}</span
				>{/if}
			<span class="mt-0.5 font-display text-lg font-bold text-primary">WowCompany</span>
		</span>
		<span class="ml-auto text-xs text-muted-foreground">{brandName(preview)}</span>
	</div>
</section>
