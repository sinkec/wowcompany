<script lang="ts">
	import { api, errText, type Status } from './api';

	let { status, onskip }: { status: Status; onskip: () => void } = $props();
	let busy = $state(false);
	let error = $state<string | null>(null);

	const pending = $derived(status.auth.pending);
	const shownError = $derived(error ?? status.auth.error);

	async function start() {
		busy = true;
		error = null;
		try {
			await api.startLink();
		} catch (e) {
			error = errText(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="mx-auto max-w-lg space-y-6 pt-6 text-center">
	<div class="space-y-2">
		<h2 class="text-2xl font-bold text-primary">Prove you're one of us</h2>
		<p class="text-muted-foreground">
			Link this PC to your WowCompany account. Your browser opens the portal, you sign in with
			Google and click
			<b>Approve</b>. No passwords here — we wouldn't trust ourselves with them either.
		</p>
	</div>

	<div class="wow-frame space-y-4 rounded-lg p-6">
		{#if pending}
			<p class="text-sm text-muted-foreground">Approve this code in your browser:</p>
			<p class="font-mono text-3xl font-bold tracking-widest text-primary select-text">
				{pending.code}
			</p>
			<p class="text-sm text-muted-foreground">
				Waiting for the Guild Master's paperwork…
				<span class="inline-block animate-pulse">⏳</span>
			</p>
			<div class="flex justify-center gap-2">
				<button class="btn btn-outline" onclick={() => api.openUrl(pending.linkUrl)}
					>Open browser again</button
				>
				<button class="btn btn-outline" onclick={() => api.cancelLink()}>Cancel</button>
			</div>
		{:else}
			<button class="btn btn-primary px-6 py-2 text-base" disabled={busy} onclick={start}>
				{busy ? 'Summoning the portal…' : 'Sign in with Google'}
			</button>
			<p class="text-xs text-muted-foreground">
				Members only. Not a member? Petition the Guild Master on the portal first.
			</p>
		{/if}
		{#if shownError}
			<p class="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm">
				{shownError}
			</p>
		{/if}
	</div>

	<button class="text-sm text-muted-foreground underline hover:text-foreground" onclick={onskip}>
		Skip for now — just record locally
	</button>
	<p class="text-xs text-muted-foreground">Talking to {status.apiBase}</p>
</div>
