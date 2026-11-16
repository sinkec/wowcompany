<script lang="ts">
	// Samodejna posodobitev: ob zagonu in vsakih 6 ur preveri latest.json na GitHub Releases
	// (podpisano, tauri-plugin-updater). Nastavitev autoUpdate: namesti sama, sicer vpraša.
	// Po ponovnem zagonu nova verzija sama posodobi addon v mapi igre (engine.rs auto_update_addon).
	import { onMount } from 'svelte';
	import { check, type Update } from '@tauri-apps/plugin-updater';
	import { relaunch } from '@tauri-apps/plugin-process';
	import { errText, type Status } from './api';

	let { status }: { status: Status } = $props();

	let update = $state<Update | null>(null);
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);
	let dismissed = $state(false);
	let addonSeen = $state<number | null>(null);

	async function look() {
		try {
			const u = await check();
			if (!u) return;
			update = u;
			if (status.settings.autoUpdate && !status.watch.runInProgress) await install();
		} catch {
			// brez interneta / GitHub ne odgovori: poskusimo kasneje, brez hrupa
		}
	}

	async function install() {
		if (!update) return;
		error = null;
		let total = 0;
		let got = 0;
		busy = 'Downloading…';
		try {
			await update.downloadAndInstall((e) => {
				if (e.event === 'Started') total = e.data.contentLength ?? 0;
				if (e.event === 'Progress') {
					got += e.data.chunkLength;
					if (total) busy = `Downloading… ${Math.round((got / total) * 100)}%`;
				}
				if (e.event === 'Finished') busy = 'Installing…';
			});
			busy = 'Restarting…';
			await relaunch();
		} catch (e) {
			error = errText(e);
			busy = null;
		}
	}

	onMount(() => {
		look();
		const t = setInterval(look, 6 * 3600_000);
		return () => clearInterval(t);
	});

	const addon = $derived(status.addon.updated);
</script>

{#if update && !dismissed}
	<div
		class="flex flex-wrap items-center gap-3 border-b border-primary/40 bg-primary/10 px-5 py-2 text-sm"
	>
		<span>
			<b class="text-primary">Companion v{update.version}</b> is out (you have v{status.version}).
			{#if status.watch.runInProgress}Finish the run first – we won't restart mid-pull.{/if}
		</span>
		{#if busy}
			<span class="text-muted-foreground">{busy}</span>
		{:else}
			<button
				class="btn btn-primary"
				disabled={status.watch.runInProgress}
				onclick={install}>Update now</button
			>
			<button class="btn btn-outline" onclick={() => (dismissed = true)}>Later</button>
		{/if}
		{#if error}<span class="text-destructive">{error}</span>{/if}
		<span class="ml-auto text-xs text-muted-foreground">The addon in the game updates with it.</span>
	</div>
{/if}

{#if addon && addonSeen !== addon.at}
	<div
		class="flex flex-wrap items-center gap-3 border-b border-border/60 bg-card px-5 py-2 text-sm"
	>
		<span>
			Addon updated <b>{addon.from} → {addon.to}</b>.
			{#if addon.restart}
				It has new files: <b>restart WoW</b> to load it (a /reload is not enough this time).
			{:else}
				Type <code>/reload</code> in game to load it (or it loads at your next login).
			{/if}
		</span>
		<button class="btn btn-outline ml-auto" onclick={() => (addonSeen = addon.at)}>Got it</button>
	</div>
{/if}
