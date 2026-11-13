<script lang="ts">
	import { api, errText, fmtDuration, type RunRow, type Status } from './api';

	let { status }: { status: Status } = $props();
	let rows = $state<RunRow[]>([]);
	let error = $state<string | null>(null);
	let loadedVersion = -1;

	async function load() {
		try {
			rows = await api.listRuns(200);
			error = null;
		} catch (e) {
			error = errText(e);
		}
	}

	$effect(() => {
		if (status.runsVersion !== loadedVersion) {
			loadedVersion = status.runsVersion;
			load();
		}
	});

	const STATUS = {
		pending: { label: 'Waiting', cls: 'bg-primary/20 text-primary' },
		uploaded: { label: 'Uploaded', cls: 'bg-success/20 text-success' },
		failed: { label: 'Rejected', cls: 'bg-destructive/20 text-destructive' }
	} as const;

	async function remove(r: RunRow) {
		if (!confirm(`Forget ${r.zone} from this PC? (Already uploaded runs stay on the portal.)`))
			return;
		await api.deleteRun(r.runKey);
	}
</script>

{#if error}<p class="mb-3 text-sm text-destructive">{error}</p>{/if}

{#if !rows.length}
	<div class="wow-frame mx-auto max-w-xl rounded-lg p-8 text-center text-muted-foreground">
		No runs yet. Every dungeon you finish with your party lands here — and on the portal, where
		everyone can laugh at your deaths.
	</div>
{:else}
	<ul class="space-y-2">
		{#each rows as r (r.runKey)}
			<li class="wow-frame flex items-center gap-4 rounded-lg p-3">
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="font-semibold text-primary">{r.zone}</span>
						<span class="badge {STATUS[r.status].cls}">{STATUS[r.status].label}</span>
					</div>
					<div class="text-xs text-muted-foreground">
						{new Date(r.startedAt).toLocaleString()} · {fmtDuration(r.durationMs)} · bosses {r.bossesKilled}{r.bossesTotal
							? `/${r.bossesTotal}`
							: ''} · {r.deaths} death{r.deaths === 1 ? '' : 's'}
					</div>
					<div class="truncate text-xs text-muted-foreground">{r.players.join(', ')}</div>
					{#if r.lastError && r.status !== 'uploaded'}
						<div class="truncate text-xs text-destructive" title={r.lastError}>
							{r.status === 'pending' ? `Retrying (${r.attempts}×): ` : ''}{r.lastError}
						</div>
					{/if}
				</div>
				<div class="flex shrink-0 gap-2">
					{#if r.url}
						<button class="btn btn-outline" onclick={() => api.openUrl(r.url!)}
							>Open on portal</button
						>
					{/if}
					{#if r.status !== 'uploaded'}
						<button class="btn btn-outline" onclick={() => api.retryRun(r.runKey)}>Retry</button>
					{/if}
					<button class="btn btn-danger" title="Forget on this PC" onclick={() => remove(r)}
						>✕</button
					>
				</div>
			</li>
		{/each}
	</ul>
{/if}
