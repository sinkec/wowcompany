<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';
	import { api, ago, errText, type Candidate, type Settings, type Status } from './api';

	let { status }: { status: Status } = $props();

	// lokalna kopija za urejanje; ob shranjevanju gre v Rust
	// namerno samo začetna vrednost: urejamo lokalno, dokler uporabnik ne shrani
	const initial = () => structuredClone($state.snapshot(status.settings)) as Settings;
	let draft = $state<Settings>(initial());
	let candidates = $state<Candidate[] | null>(null);
	let searching = $state(false);
	let saved = $state<string | null>(null);
	let error = $state<string | null>(null);

	const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(status.settings));

	async function save(next: Settings = draft) {
		error = null;
		try {
			await api.saveSettings($state.snapshot(next) as Settings);
			saved = 'Saved.';
			setTimeout(() => (saved = null), 2000);
		} catch (e) {
			error = errText(e);
		}
	}

	async function find() {
		searching = true;
		try {
			candidates = await api.locateLogs();
		} catch (e) {
			error = errText(e);
		} finally {
			searching = false;
		}
	}

	async function browse() {
		const dir = await open({ directory: true, title: 'Pick the World of Warcraft “Logs” folder' });
		if (typeof dir === 'string') {
			draft.logsDir = dir;
			await save();
		}
	}

	async function useDir(path: string | null) {
		draft.logsDir = path;
		await save();
	}

	let deleting = $state(false);
	async function deleteNow() {
		if (!confirm('Delete old combat and chat logs from the Logs folder now?')) return;
		deleting = true;
		error = null;
		try {
			const r = await api.deleteLogsNow();
			saved = `Deleted ${r.deleted.length} file${r.deleted.length === 1 ? '' : 's'}.`;
			setTimeout(() => (saved = null), 3000);
		} catch (e) {
			error = errText(e);
		} finally {
			deleting = false;
		}
	}

	async function unlink() {
		if (!confirm('Unlink this PC? Runs will stay here but stop uploading until you link again.'))
			return;
		await api.unlink();
	}

	const ageText = (s: number | null) =>
		s === null ? 'no combat logs yet' : `newest log ${ago(Date.now() - s * 1000)}`;
</script>

<div class="max-w-3xl space-y-6">
	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Combat log folder</h2>
		<p class="text-sm">
			{#if status.watch.logsDir}
				<span class="font-mono text-xs break-all select-text">{status.watch.logsDir}</span>
				{#if status.watch.logsDirAuto}<span class="badge ml-1 bg-primary/20 text-primary">auto</span
					>{/if}
			{:else}
				<span class="text-destructive">Not found.</span>
			{/if}
		</p>
		<div class="flex flex-wrap gap-2">
			<button class="btn btn-outline" onclick={find} disabled={searching}
				>{searching ? 'Searching…' : 'Find automatically'}</button
			>
			<button class="btn btn-outline" onclick={browse}>Browse…</button>
			{#if status.settings.logsDir}
				<button class="btn btn-outline" onclick={() => useDir(null)}>Back to auto-detect</button>
			{/if}
		</div>
		{#if candidates}
			{#if !candidates.length}
				<p class="text-sm text-muted-foreground">
					Nothing found. On Linux we look in Steam/Proton, Lutris, Bottles and ~/.wine prefixes; on
					Windows on every drive. Use Browse… and pick <code>World of Warcraft/_forever_/Logs</code
					>.
				</p>
			{:else}
				<ul class="space-y-1">
					{#each candidates as c (c.path)}
						<li class="flex items-center gap-2 rounded-md border border-border/50 p-2 text-xs">
							<span class="badge bg-secondary">{c.flavor}</span>
							<span class="min-w-0 flex-1 truncate font-mono" title={c.path}>{c.path}</span>
							<span class="shrink-0 text-muted-foreground">{ageText(c.newestAgeSecs)}</span>
							<button class="btn btn-outline shrink-0 py-0.5" onclick={() => useDir(c.path)}
								>Use</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
		<p class="text-xs text-muted-foreground">
			Reminder: type <code class="text-primary">/combatlog</code> (and
			<code class="text-primary">/chatlog</code>
			for loot) in game every session. Full steps in <b>How to log</b>.
		</p>
	</section>

	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Log files</h2>
		<label class="flex items-center gap-3 text-sm">
			<input
				type="checkbox"
				bind:checked={draft.deleteLogsOnExit}
				onchange={() => save({ ...status.settings, deleteLogsOnExit: draft.deleteLogsOnExit })}
				class="size-4 accent-[var(--primary)]"
			/>
			Delete combat and chat logs once WoW is closed and every run is on the portal
		</label>
		<p class="text-xs text-muted-foreground">
			Only <code>WoWCombatLog*.txt</code> and <code>WoWChatLog*.txt</code>, a minute after you close
			WoW (and when the app quits). Logs stay while a run is being recorded or a run has not reached
			the portal yet – the log is the only copy until then. Not linked or uploads off: the run saved
			in the app is the copy, so the logs go.
		</p>
		<label class="flex flex-wrap items-center gap-2 text-sm">
			Keep logs for
			<input
				type="number"
				min="0"
				max="365"
				bind:value={draft.keepLogsDays}
				onchange={() =>
					save({
						...status.settings,
						keepLogsDays: Math.max(0, Math.min(365, Math.round(Number(draft.keepLogsDays) || 0)))
					})}
				class="w-16 rounded-md border border-border bg-background/60 px-2 py-1 text-right tabular-nums"
			/>
			days
			<span class="text-xs text-muted-foreground"
				>(0 = as soon as the runs are on the portal; more if you also upload logs elsewhere)</span
			>
		</label>
		<div class="flex flex-wrap items-center gap-3">
			<button
				class="btn btn-outline"
				onclick={deleteNow}
				disabled={deleting || !status.watch.logsDir}
			>
				{deleting ? 'Shredding…' : 'Delete logs now'}
			</button>
			{#if status.watch.lastCleanup}
				{@const c = status.watch.lastCleanup}
				<span class="text-xs text-muted-foreground">
					Last cleanup {ago(c.at)}: {c.deleted.length} deleted ({(c.freedBytes / 1_048_576).toFixed(
						1
					)} MB){#if c.kept.length},
						{c.kept.length} kept{/if}.
				</span>
			{/if}
		</div>
		{#if status.watch.lastCleanup?.waiting}
			<p class="text-xs text-muted-foreground">
				Logs kept for now: {status.watch.lastCleanup.waiting}. They go once that is done.
			</p>
		{/if}
		{#if status.watch.lastCleanup?.kept.length}
			<ul class="text-xs text-muted-foreground">
				{#each status.watch.lastCleanup.kept as [file, why] (file)}
					<li><span class="font-mono">{file}</span> — {why}</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="wow-frame space-y-4 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Recording</h2>
		<label class="flex items-center gap-3 text-sm">
			<input
				type="checkbox"
				bind:checked={draft.uploadsEnabled}
				class="size-4 accent-[var(--primary)]"
			/>
			Upload finished runs to the portal automatically
		</label>
		<label class="block space-y-1 text-sm">
			<span>Minimum group members for a run</span>
			<select class="field w-40" bind:value={draft.minPlayers}>
				<option value={1}>1 (count solo runs)</option>
				<option value={2}>2 (default)</option>
				<option value={3}>3</option>
				<option value={5}>5 (full party only)</option>
			</select>
		</label>
		<label class="block space-y-1 text-sm">
			<span>Device name (shown in “My devices” on the portal)</span>
			<input class="field" bind:value={draft.deviceName} maxlength="64" />
		</label>
		<details class="text-sm">
			<summary class="cursor-pointer text-muted-foreground">Advanced</summary>
			<label class="mt-2 block space-y-1">
				<span>Server (leave empty for the real one)</span>
				<input
					class="field font-mono text-xs"
					bind:value={draft.apiUrl}
					placeholder={status.apiBase}
				/>
			</label>
		</details>
		<div class="flex items-center gap-3">
			<button class="btn btn-primary" disabled={!dirty} onclick={() => save()}>Save</button>
			{#if saved}<span class="text-success text-sm">{saved}</span>{/if}
			{#if error}<span class="text-sm text-destructive">{error}</span>{/if}
		</div>
	</section>

	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Updates</h2>
		<label class="flex items-center gap-3 text-sm">
			<input
				type="checkbox"
				bind:checked={draft.autoUpdate}
				onchange={() => save({ ...status.settings, autoUpdate: draft.autoUpdate })}
				class="size-4 accent-[var(--primary)]"
			/>
			Install new Companion versions without asking
		</label>
		<label class="flex items-center gap-3 text-sm">
			<input
				type="checkbox"
				bind:checked={draft.autoUpdateAddon}
				onchange={() => save({ ...status.settings, autoUpdateAddon: draft.autoUpdateAddon })}
				class="size-4 accent-[var(--primary)]"
			/>
			Keep the WowCompany addon in the game up to date
		</label>
		<p class="text-xs text-muted-foreground">
			The app checks GitHub for a new version when it starts and every 6 hours (signed releases
			only). Never during a run. The game reads addon files only when it loads, so after an addon
			update type <code>/reload</code> – or restart WoW when the update brings new files; the app tells
			you which.
		</p>
	</section>

	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Account</h2>
		{#if status.auth.linked}
			<p class="text-sm">
				Linked as <b>{status.settings.deviceName}</b>. Last upload {ago(
					status.upload.lastUploadAt
				)}.
				{#if status.upload.lastError}<br /><span class="text-destructive"
						>Last problem: {status.upload.lastError}</span
					>{/if}
			</p>
			<button class="btn btn-danger" onclick={unlink}>Unlink this PC</button>
		{:else}
			<p class="text-sm text-muted-foreground">Not linked. Runs are only kept locally.</p>
		{/if}
		<p class="text-xs text-muted-foreground">Server: {status.apiBase} · v{status.version}</p>
	</section>
</div>
