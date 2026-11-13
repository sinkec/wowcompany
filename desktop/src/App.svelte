<script lang="ts">
	import { onMount } from 'svelte';
	import { api, errText, type Status } from './lib/api';
	import LinkPanel from './lib/LinkPanel.svelte';
	import Live from './lib/Live.svelte';
	import Runs from './lib/Runs.svelte';
	import SettingsView from './lib/Settings.svelte';

	let status = $state<Status | null>(null);
	let error = $state<string | null>(null);
	let tab = $state<'live' | 'runs' | 'settings'>('live');
	let skipLink = $state(false);

	async function refresh() {
		try {
			status = await api.status();
			error = null;
		} catch (e) {
			error = errText(e);
		}
	}

	onMount(() => {
		refresh();
		const t = setInterval(refresh, 1000);
		return () => clearInterval(t);
	});

	const needsLink = $derived(!!status && !status.auth.linked && !skipLink);
</script>

<div class="flex h-screen flex-col">
	<header class="flex items-center gap-4 border-b border-border/60 px-5 py-3">
		<div class="min-w-0">
			<h1 class="text-lg font-bold text-primary">WowCompany Companion</h1>
			<p class="truncate text-xs text-muted-foreground">
				{#if !status}Waking up…
				{:else if status.watch.runInProgress && status.watch.dungeon}🔴 Recording <b
						>{status.watch.dungeon}</b
					>
				{:else if status.watch.runInProgress}⏸ Run paused — corpse run? We'll wait 15 min.
				{:else if status.watch.dungeon}In {status.watch.dungeon}. Pull something already.
				{:else if status.watch.file}Watching {status.watch.file}. Go find a dungeon.
				{:else}No combat log yet. Type <code>/combatlog</code> in game.{/if}
			</p>
		</div>
		{#if status && !needsLink}
			<nav class="ml-auto flex gap-1">
				{#each [['live', 'Live'], ['runs', `Runs${status.queue.pending ? ` (${status.queue.pending}⏳)` : ''}`], ['settings', 'Settings']] as [key, label] (key)}
					<button
						class="btn {tab === key
							? 'bg-primary/15 text-primary'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => (tab = key as typeof tab)}>{label}</button
					>
				{/each}
			</nav>
		{/if}
	</header>

	<main class="wow-scroll flex-1 overflow-y-auto p-5">
		{#if error}
			<p class="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
				{error}
			</p>
		{/if}
		{#if !status}
			<div class="h-40 animate-pulse rounded-lg bg-muted"></div>
		{:else if needsLink}
			<LinkPanel {status} onskip={() => (skipLink = true)} />
		{:else}
			{#if !status.auth.linked}
				<div
					class="mb-4 flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm"
				>
					<span
						>Not linked — runs are kept on this PC only. Nobody will witness your glory (or your
						deaths).</span
					>
					<button class="btn btn-primary shrink-0" onclick={() => (skipLink = false)}
						>Link account</button
					>
				</div>
			{:else if status.auth.error}
				<div
					class="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
				>
					<span>{status.auth.error}</span>
					<button
						class="btn btn-primary shrink-0"
						onclick={() => ((skipLink = false), api.unlink())}>Link again</button
					>
				</div>
			{/if}
			{#if status.watch.error}
				<div
					class="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
				>
					<span>{status.watch.error}</span>
					<button class="btn btn-outline shrink-0" onclick={() => (tab = 'settings')}
						>Settings</button
					>
				</div>
			{/if}

			{#if tab === 'live'}
				<Live {status} />
			{:else if tab === 'runs'}
				<Runs {status} />
			{:else}
				<SettingsView {status} />
			{/if}
		{/if}
	</main>

	{#if status}
		<footer
			class="flex gap-4 border-t border-border/60 px-5 py-1.5 text-[11px] text-muted-foreground"
		>
			<span>v{status.version}</span>
			<span>{status.watch.lines.toLocaleString('en-US')} lines read</span>
			{#if status.watch.badLines}<span class="text-destructive"
					>{status.watch.badLines} unreadable</span
				>{/if}
			<span
				>last line {status.watch.lastLineAt
					? new Date(status.watch.lastLineAt).toLocaleTimeString()
					: '—'}</span
			>
			<span class="ml-auto">
				{status.queue.uploaded} uploaded · {status.queue.pending} waiting{#if status.queue.failed}<span
						class="text-destructive">&nbsp;· {status.queue.failed} failed</span
					>{/if}
			</span>
		</footer>
	{/if}
</div>
