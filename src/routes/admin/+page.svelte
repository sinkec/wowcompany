<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { toast } from 'svelte-sonner';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Trash from '@lucide/svelte/icons/trash-2';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Send from '@lucide/svelte/icons/send';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { FIELD_LABELS, ago, classColor, fmt } from '#lib/wow.js';
	import { POST_FIELDS } from '#convex/lib/discordEmbed.js';

	const auth = useAuth();
	const client = useConvexClient();
	const me = useQuery(api.auth.me, () => (auth.isAuthenticated ? {} : 'skip'));
	const isAdmin = $derived(me.data?.role === 'admin');
	const ov = useQuery(api.admin.overview, () => (isAdmin ? {} : 'skip'));
	const claims = useQuery(api.claims.listForAdmin, () => (isAdmin ? {} : 'skip'));

	const pendingCount = $derived(claims.data?.pending.length ?? 0);

	async function run<T>(p: Promise<T>, ok?: string) {
		try {
			const r = await p;
			if (ok) toast.success(ok);
			return r;
		} catch (e) {
			toast.error((e as Error).message);
		}
	}

	const decide = (claimId: Id<'claims'>, accept: boolean, name: string) =>
		run(
			client.mutation(api.claims.decide, { claimId, accept }),
			accept ? `${name} is in. May god have mercy on their soul.` : `${name} rejected. Brutal.`
		);

	// --- add hero directly
	let addName = $state('');
	let adding = $state(false);
	async function addHero(e: SubmitEvent) {
		e.preventDefault();
		if (adding || addName.trim().length < 3) return;
		adding = true;
		const r = await run(client.action(api.admin.addPlayer, { name: addName }));
		adding = false;
		if (!r) return;
		if (r.ok) {
			toast.success(`${r.name} (lvl ${r.level}) added. Data arrives within a minute.`);
			addName = '';
		} else toast.error(r.error);
	}

	// --- visibility (splet za tujce / Discord kanal)
	type Target = 'publicFields' | 'discordFields';
	function toggleField(target: Target, field: string, on: boolean) {
		if (!ov.data) return;
		const set = new Set(ov.data.settings[target]);
		if (on) set.add(field);
		else set.delete(field);
		run(client.mutation(api.admin.updateSettings, { [target]: [...set] }));
	}
	function setAll(target: Target, on: boolean) {
		if (!ov.data) return;
		run(client.mutation(api.admin.updateSettings, { [target]: on ? [...ov.data.fields] : [] }), on ? 'All on.' : 'All off.');
	}
	/** Discord: glavno stikalo na vrh, ostalo po vrsti. */
	const fieldsFor = (target: Target) =>
		target === 'discordFields'
			? ['lastLogin', ...(ov.data?.fields ?? []).filter((f) => f !== 'lastLogin')]
			: (ov.data?.fields ?? []);
	const sessionsOn = $derived(ov.data?.settings.discordFields.includes('lastLogin') ?? false);

	let sendingTest = $state(false);
	async function sendTest() {
		sendingTest = true;
		const r = await run(client.action(api.discord.sendTest, {}));
		sendingTest = false;
		if (r?.ok) toast.success('Raven sent. Go check Discord.');
		else if (r) toast.error(r.error ?? 'Failed');
	}

	// --- portal room
	const integ = useQuery(api.integrations.status, () => (isAdmin ? {} : 'skip'));
	let webhookInput = $state('');
	let tokenInput = $state('');
	let guildInput = $state('');
	let savingWebhook = $state(false);
	let savingBot = $state(false);
	async function saveWebhook(e: SubmitEvent) {
		e.preventDefault();
		savingWebhook = true;
		const r = await run(client.action(api.integrations.saveWebhook, { url: webhookInput }));
		savingWebhook = false;
		if (!r) return;
		if (r.ok) {
			toast.success(r.message);
			webhookInput = '';
		} else toast.error(r.error);
	}
	async function saveBot(e: SubmitEvent) {
		e.preventDefault();
		savingBot = true;
		const r = await run(client.action(api.integrations.saveBot, { token: tokenInput }));
		savingBot = false;
		if (!r) return;
		if (r.ok) {
			toast.success(r.message);
			tokenInput = '';
		} else toast.error(r.error);
	}
	async function saveGuild(e: SubmitEvent) {
		e.preventDefault();
		const ok = await run(client.mutation(api.integrations.setGuild, { guildId: guildInput }), 'Server ID saved.');
		if (ok !== undefined) guildInput = '';
	}
	const clearIntegration = (what: 'webhook' | 'bot') =>
		run(client.mutation(api.integrations.clear, { what }), what === 'webhook' ? 'Raven released.' : 'Bot unbound.');
	const sourceLabel = (src: 'web' | 'env' | null) => (src === 'web' ? 'set here' : src === 'env' ? 'from env variable' : '');
	let webhookCheck = $state<string | null>(null);
	async function checkWebhook() {
		webhookCheck = 'checking…';
		const r = await run(client.action(api.integrations.checkWebhook, {}));
		webhookCheck = !r ? null : r.ok ? `Alive. Posting as "${r.name}" into channel ${r.channelId}.` : r.error;
	}
	let registering = $state(false);
	let registerResult = $state<string | null>(null);
	async function registerCommands() {
		registering = true;
		const r = await run(client.action(api.bot.registerCommands, {}));
		registering = false;
		if (!r) return;
		registerResult = r.ok ? `Registered ${r.commands.join(', ')} · ${r.scope}` : r.error;
		if (r.ok) toast.success('Slash commands registered. Type / in Discord.');
		else toast.error(r.error);
	}
	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		toast.success('Copied.');
	}

	const DISCORD_LABELS: Record<string, string> = {
		lastLogin: 'Post session summaries on logout (master switch)'
	};
	const VIS_COLUMNS: { target: Target; title: string; note: string }[] = [
		{
			target: 'publicFields',
			title: 'Website — strangers',
			note: 'What visitors who are not signed in (or not vouched for) can see. Members and you always see everything.'
		},
		{
			target: 'discordFields',
			title: 'Discord channel',
			note: 'What goes into session posts and slash commands. Fields tagged “slash commands only” can’t appear in a logout post.'
		}
	];

	// --- settings
	const INTERVALS = [1, 2, 5, 10, 15, 30, 60];
	const pct = (v: number, limit: number) => Math.min(100, Math.round((v / limit) * 100));
</script>

<svelte:head><title>Guild Master's Office — WowCompany</title></svelte:head>

{#if auth.isLoading || (auth.isAuthenticated && me.isLoading)}
	<div class="h-60 animate-pulse rounded-lg bg-muted"></div>
{:else if !isAdmin}
	<div class="wow-frame mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg p-12 text-center">
		<ShieldAlert class="size-12 text-destructive" />
		<h1 class="text-2xl font-bold">Guild Master only</h1>
		<p class="text-muted-foreground">You are not the Guild Master. The guards have been notified. They don't care, but still.</p>
	</div>
{:else}
	<div class="space-y-6">
		<section>
			<h1 class="text-3xl font-bold text-primary md:text-4xl">The Guild Master's Office</h1>
			<p class="text-muted-foreground">Judge petitions, banish heroes, decide who sees what. Power corrupts. Enjoy.</p>
		</section>

		<Tabs.Root value="petitions">
			<Tabs.List class="flex-wrap">
				<Tabs.Trigger value="petitions">
					Petitions {#if pendingCount}<Badge class="ml-1.5 h-5 px-1.5">{pendingCount}</Badge>{/if}
				</Tabs.Trigger>
				<Tabs.Trigger value="heroes">Heroes</Tabs.Trigger>
				<Tabs.Trigger value="visibility">Visibility</Tabs.Trigger>
				<Tabs.Trigger value="settings">Settings & Budget</Tabs.Trigger>
				<Tabs.Trigger value="portals">Portal Room</Tabs.Trigger>
				<Tabs.Trigger value="members">Members</Tabs.Trigger>
			</Tabs.List>

			<!-- PETITIONS -->
			<Tabs.Content value="petitions" class="mt-4 space-y-6">
				{#if !claims.data?.pending.length}
					<p class="wow-frame rounded-lg p-8 text-center text-muted-foreground italic">
						No petitions. Nobody wants to join. Can't imagine why.
					</p>
				{:else}
					<ul class="grid gap-3 md:grid-cols-2">
						{#each claims.data.pending as c (c.id)}
							<li class="wow-frame space-y-3 rounded-lg p-4">
								<div>
									<div class="font-display text-lg font-semibold" style="color: {classColor(c.preview.classId)}">{c.name}</div>
									<div class="text-sm">Level {c.preview.level} {c.preview.race} {c.preview.className}</div>
									<div class="text-xs text-muted-foreground">
										{c.preview.guild ? `<${c.preview.guild}> · ` : 'no guild · '}by {c.email} · {ago(c.createdAt)}
									</div>
								</div>
								<div class="flex gap-2">
									<Button size="sm" onclick={() => decide(c.id, true, c.name)}><Check class="size-4" /> Accept</Button>
									<Button size="sm" variant="ghost" onclick={() => decide(c.id, false, c.name)}><X class="size-4" /> Reject</Button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#if claims.data?.decided.length}
					<section>
						<h2 class="mb-2 text-sm font-semibold text-primary">Recently judged</h2>
						<ul class="space-y-1 text-sm">
							{#each claims.data.decided as c (c.id)}
								<li class="flex justify-between gap-3">
									<span>{c.name} <span class="text-muted-foreground">· {c.email}</span></span>
									<span class={c.status === 'accepted' ? 'text-[#1eff00]' : 'text-destructive'}>
										{c.status} {ago(c.decidedAt)}
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</Tabs.Content>

			<!-- HEROES -->
			<Tabs.Content value="heroes" class="mt-4 space-y-4">
				<form onsubmit={addHero} class="wow-frame flex flex-wrap items-end gap-3 rounded-lg p-4">
					<div class="min-w-60 flex-1">
						<label for="add" class="text-sm font-semibold text-primary">Add a hero directly</label>
						<Input id="add" bind:value={addName} placeholder="Firstname Surname" disabled={adding} />
					</div>
					<Button type="submit" disabled={adding || addName.trim().length < 3}>{adding ? 'Asking Blizzard…' : 'Add'}</Button>
				</form>
				<div class="wow-frame overflow-x-auto rounded-lg">
					<table class="w-full text-sm">
						<thead class="text-left text-xs text-muted-foreground uppercase">
							<tr class="border-b border-border">
								<th class="p-3">Hero</th><th class="p-3">Level</th><th class="p-3">Owner</th><th class="p-3">Updated</th><th></th>
							</tr>
						</thead>
						<tbody>
							{#each ov.data?.players ?? [] as p (p.id)}
								<tr class="border-b border-border/50 last:border-0">
									<td class="p-3">
										<a href="/c/{p.slug}" class="font-medium hover:underline" style="color: {classColor(p.classId ?? 0)}">{p.displayName}</a>
										<div class="text-xs text-muted-foreground">{p.className ?? 'no data yet'}</div>
									</td>
									<td class="p-3 tabular-nums">{p.level ?? '–'}</td>
									<td class="p-3 text-muted-foreground">{p.owner ?? 'added by you'}</td>
									<td class="p-3 text-muted-foreground">{p.updatedAt ? ago(p.updatedAt) : 'pending'}</td>
									<td class="p-3 text-right">
										<AlertDialog.Root>
											<AlertDialog.Trigger class={buttonVariants({ variant: 'ghost', size: 'sm' })}>
												<Trash class="size-4" />
											</AlertDialog.Trigger>
											<AlertDialog.Content>
												<AlertDialog.Header>
													<AlertDialog.Title>Banish {p.displayName}?</AlertDialog.Title>
													<AlertDialog.Description>
														All their history, gossip and shameful stats get deleted. Forever. Like their dignity.
													</AlertDialog.Description>
												</AlertDialog.Header>
												<AlertDialog.Footer>
													<AlertDialog.Cancel>Spare them</AlertDialog.Cancel>
													<AlertDialog.Action
														onclick={() => run(client.mutation(api.admin.removePlayer, { playerId: p.id }), `${p.displayName} banished.`)}
														>Banish</AlertDialog.Action
													>
												</AlertDialog.Footer>
											</AlertDialog.Content>
										</AlertDialog.Root>
									</td>
								</tr>
							{:else}
								<tr><td colspan="5" class="p-6 text-center text-muted-foreground italic">Empty roster. Lonely at the top.</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Tabs.Content>

			<!-- VISIBILITY -->
			<Tabs.Content value="visibility" class="mt-4 space-y-3">
				<p class="text-sm text-muted-foreground">
					Filtering happens on the server, so no sneaky devtools peeking. Hero names and profile links are always shown — a
					page about nobody would be weird.
				</p>
				<div class="grid gap-4 lg:grid-cols-2">
					{#each VIS_COLUMNS as col (col.target)}
						<section class="wow-frame rounded-lg p-4">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<div>
									<h2 class="font-display text-lg font-semibold text-primary">{col.title}</h2>
									<p class="text-xs text-muted-foreground">{col.note}</p>
								</div>
								<div class="flex gap-1">
									<Button size="sm" variant="secondary" onclick={() => setAll(col.target, true)}>Select all</Button>
									<Button size="sm" variant="ghost" onclick={() => setAll(col.target, false)}>Deselect all</Button>
								</div>
							</div>

							<div class="mt-3">
								{#each fieldsFor(col.target) as f, i (f)}
									{@const on = ov.data?.settings[col.target].includes(f) ?? false}
									{@const master = col.target === 'discordFields' && f === 'lastLogin'}
									<label
										class="flex items-center justify-between gap-3 py-2 text-sm {master
											? 'mb-2 rounded-md border border-primary/50 bg-primary/10 px-3 font-semibold'
											: 'border-b border-border/40 last:border-0'} {col.target === 'discordFields' && !master && !sessionsOn
											? 'opacity-50'
											: ''}"
									>
										<span class="flex flex-wrap items-center gap-2">
											{(col.target === 'discordFields' && DISCORD_LABELS[f]) || FIELD_LABELS[f] || f}
											{#if col.target === 'discordFields' && !master && !POST_FIELDS.includes(f)}
												<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">slash commands only</span>
											{/if}
										</span>
										<Switch checked={on} onCheckedChange={(v) => toggleField(col.target, f, v)} />
									</label>
									{#if master && !sessionsOn}
										<p class="-mt-1 mb-2 text-xs text-muted-foreground italic">
											Master switch is off: nothing gets posted, no matter what's below.
										</p>
									{/if}
								{/each}
							</div>

							{#if col.target === 'discordFields'}
								<div class="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
									<Button size="sm" onclick={sendTest} disabled={!sessionsOn || sendingTest || !integ.data?.webhook.configured}>
										<Send class="size-4" /> {sendingTest ? 'Sending raven…' : 'Send test post'}
									</Button>
									<span class="text-xs text-muted-foreground">
										{#if !integ.data?.webhook.configured}No webhook yet — see Portal Room.
										{:else if !sessionsOn}Turn on the master switch to send posts.
										{:else}Posts a fake session using exactly these switches.{/if}
									</span>
								</div>
							{/if}
						</section>
					{/each}
				</div>
			</Tabs.Content>

			<!-- SETTINGS -->
			<Tabs.Content value="settings" class="mt-4 grid gap-4 lg:grid-cols-2">
				{#if ov.data}
					{@const st = ov.data.settings}
					{@const est = ov.data.estimate}
					<section class="wow-frame space-y-4 rounded-lg p-4">
						<h2 class="text-sm font-semibold text-primary">Blizzard polling</h2>
						<div>
							<div class="mb-2 text-sm">Check every</div>
							<div class="flex flex-wrap gap-1">
								{#each INTERVALS as m (m)}
									<button
										class="rounded-md px-3 py-1 text-sm transition-colors {st.pollIntervalSec === m * 60
											? 'bg-primary text-primary-foreground'
											: 'bg-muted text-muted-foreground hover:bg-accent'}"
										onclick={() => run(client.mutation(api.admin.updateSettings, { pollIntervalSec: m * 60 }))}
										>{m} min</button
									>
								{/each}
							</div>
							<p class="mt-2 text-xs text-muted-foreground">
								Blizzard only updates a hero when they log out, so 1–2 minutes means news within minutes.
							</p>
						</div>
						<label class="flex items-center justify-between gap-3 text-sm">
							<span>Pause polling <span class="text-muted-foreground">(emergency brake for the free tier)</span></span>
							<Switch checked={st.paused} onCheckedChange={(v) => run(client.mutation(api.admin.updateSettings, { paused: v }))} />
						</label>
						<div class="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
							<span>
								Guild roster for name suggestions: {fmt(ov.data.roster.count)} members
								<span class="text-muted-foreground">· {ov.data.roster.fetchedAt ? ago(ov.data.roster.fetchedAt) : 'never'}</span>
							</span>
							<Button size="sm" variant="secondary" onclick={() => run(client.action(api.admin.refreshRoster, {}), 'Roster refreshed')}>
								<RefreshCw class="size-4" />
							</Button>
						</div>
					</section>

					<section class="wow-frame space-y-3 rounded-lg p-4">
						<h2 class="text-sm font-semibold text-primary">Convex free tier budget (rough estimate)</h2>
						<p class="text-xs text-muted-foreground">
							{ov.data.activePlayers} heroes · {fmt(est.runsPerMonth)} poll runs / month. Real numbers live in the Convex dashboard
							→ Usage.
						</p>
						{#each [
							{ l: 'Function calls', v: est.functionCalls, max: 1_000_000, u: '' },
							{ l: 'DB reads by poller', v: est.dbReadMB, max: 1024, u: ' MB' },
							{ l: 'Action compute', v: est.computeGBh, max: 20, u: ' GB-h' }
						] as b (b.l)}
							<div>
								<div class="flex justify-between text-sm">
									<span>{b.l}</span><span class="tabular-nums text-muted-foreground">{fmt(b.v, b.u === ' GB-h' ? 2 : 0)}{b.u} / {fmt(b.max)}{b.u}</span>
								</div>
								<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-background/60">
									<div
										class="h-full rounded-full {pct(b.v, b.max) > 80 ? 'bg-destructive' : 'bg-primary'}"
										style="width: {Math.max(2, pct(b.v, b.max))}%"
									></div>
								</div>
							</div>
						{/each}
					</section>
				{/if}
			</Tabs.Content>

			<!-- PORTAL ROOM -->
			<Tabs.Content value="portals" class="mt-4 space-y-4">
				<p class="text-sm text-muted-foreground">
					Where this tavern connects to the outside world. Everything here can be set from the browser, even after
					deploying. Secrets are write-only: once saved, they never come back to any browser — not even yours.
				</p>
				{#if integ.data}
					{@const st = integ.data}
					<div class="grid gap-4 lg:grid-cols-2">
						<!-- webhook -->
						<section class="wow-frame space-y-3 rounded-lg p-4">
							<div class="flex items-center justify-between gap-2">
								<h2 class="font-display text-lg font-semibold text-primary">Messenger Raven</h2>
								{#if st.webhook.configured}
									<Badge class="gap-1"><CircleCheck class="size-3" /> connected</Badge>
								{:else}
									<Badge variant="secondary" class="gap-1"><CircleDashed class="size-3" /> not set up</Badge>
								{/if}
							</div>
							<p class="text-sm text-muted-foreground">
								Discord webhook that posts session summaries into one channel. One-way: it talks, it never listens.
							</p>

							{#if st.webhook.configured}
								<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-background/40 p-3 text-xs">
									<dt class="text-muted-foreground">Name</dt><dd>{st.webhook.name ?? '—'}</dd>
									<dt class="text-muted-foreground">Channel ID</dt><dd>{st.webhook.channelId ?? '—'}</dd>
									<dt class="text-muted-foreground">URL</dt><dd class="truncate">{st.webhook.hint}</dd>
									<dt class="text-muted-foreground">Source</dt><dd>{sourceLabel(st.webhook.source)}</dd>
								</dl>
							{/if}

							<ol class="list-decimal space-y-1 pl-5 text-sm">
								<li>In Discord, hover the channel → <b>⚙ Edit Channel</b> → <b>Integrations</b> → <b>Webhooks</b> → <b>New Webhook</b>.</li>
								<li>Name it (e.g. <i>Tavern Gossip</i>), click <b>Copy Webhook URL</b> and paste it below.</li>
							</ol>
							<form onsubmit={saveWebhook} class="flex gap-2">
								<Input
									type="password"
									bind:value={webhookInput}
									placeholder={st.webhook.configured ? 'Paste a new URL to replace' : 'https://discord.com/api/webhooks/…'}
									autocomplete="off"
									disabled={savingWebhook}
								/>
								<Button type="submit" size="sm" disabled={savingWebhook || webhookInput.trim().length < 20}>
									{savingWebhook ? 'Checking…' : 'Save'}
								</Button>
							</form>
							<div class="flex flex-wrap items-center gap-2">
								<Button size="sm" variant="secondary" onclick={checkWebhook} disabled={!st.webhook.configured}>Check raven</Button>
								{#if st.webhook.source === 'web'}
									<Button size="sm" variant="ghost" onclick={() => clearIntegration('webhook')}>Remove</Button>
								{/if}
								{#if webhookCheck}<span class="text-xs text-muted-foreground">{webhookCheck}</span>{/if}
							</div>
						</section>

						<!-- app / slash commands -->
						<section class="wow-frame space-y-3 rounded-lg p-4">
							<div class="flex items-center justify-between gap-2">
								<h2 class="font-display text-lg font-semibold text-primary">Discord Bot (slash commands)</h2>
								{#if st.bot.configured && st.bot.publicKeySet}
									<Badge class="gap-1"><CircleCheck class="size-3" /> bound</Badge>
								{:else}
									<Badge variant="secondary" class="gap-1"><CircleDashed class="size-3" /> not set up</Badge>
								{/if}
							</div>
							<p class="text-sm text-muted-foreground">
								Lets people type <code>/roster</code>, <code>/hero</code>, <code>/leaderboard</code> in Discord. No always-online
								bot — Discord calls this site over HTTP when someone uses a command.
							</p>

							{#if st.bot.configured}
								<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-background/40 p-3 text-xs">
									<dt class="text-muted-foreground">Application</dt><dd>{st.bot.applicationName ?? '—'} ({st.bot.applicationId ?? '—'})</dd>
									<dt class="text-muted-foreground">Token</dt><dd>{st.bot.tokenHint}</dd>
									<dt class="text-muted-foreground">Public key</dt><dd>{st.bot.publicKeySet ? 'set' : 'missing'}</dd>
									<dt class="text-muted-foreground">Server ID</dt><dd>{st.guildId ?? 'not set (commands go global, up to 1 h)'}</dd>
									<dt class="text-muted-foreground">Source</dt><dd>{sourceLabel(st.bot.source)}</dd>
								</dl>
							{/if}

							<ol class="list-decimal space-y-3 pl-5 text-sm">
								<li>
									<b>Create the app:</b>
									<a href="https://discord.com/developers/applications" target="_blank" rel="noopener" class="text-primary hover:underline"
										>Discord Developer Portal</a
									>
									→ <b>New Application</b> → <b>Bot</b> → <b>Reset Token</b> → paste it here. Application ID and public key are
									fetched automatically.
									<form onsubmit={saveBot} class="mt-2 flex gap-2">
										<Input
											type="password"
											bind:value={tokenInput}
											placeholder={st.bot.configured ? 'Paste a new token to replace' : 'Bot token'}
											autocomplete="off"
											disabled={savingBot}
										/>
										<Button type="submit" size="sm" disabled={savingBot || tokenInput.trim().length < 50}>
											{savingBot ? 'Checking…' : 'Save'}
										</Button>
									</form>
									{#if st.bot.source === 'web'}
										<Button size="sm" variant="ghost" class="mt-1" onclick={() => clearIntegration('bot')}>Remove bot</Button>
									{/if}
								</li>
								<li>
									<b>Server ID</b> — taken from the webhook automatically. Different server? Right-click it in Discord →
									<b>Copy Server ID</b> (needs Developer Mode):
									<form onsubmit={saveGuild} class="mt-2 flex gap-2">
										<Input bind:value={guildInput} placeholder={st.guildId ?? '123456789012345678'} inputmode="numeric" />
										<Button type="submit" size="sm" variant="secondary" disabled={guildInput.trim().length < 17}>Save</Button>
									</form>
								</li>
								<li>
									<b>Add the bot to the server</b> (needs “Manage Server” on that Discord). It only gets the
									<i>applications.commands</i> permission — it can't read or post messages on its own:
									{#if st.inviteUrl}
										<div class="mt-1">
											<a href={st.inviteUrl} target="_blank" rel="noopener" class={buttonVariants({ size: 'sm' })}>
												<ExternalLink class="size-4" /> Invite to Discord
											</a>
										</div>
									{:else}
										<span class="text-muted-foreground"> save the bot token first.</span>
									{/if}
								</li>
								<li>
									<b>Interactions Endpoint URL</b> — paste into Developer Portal → your app → General Information → Save:
									{#if st.interactionsUrl}
										<div class="mt-1 flex items-center gap-2">
											<code class="truncate rounded bg-muted px-2 py-1 text-xs">{st.interactionsUrl}</code>
											<Button size="sm" variant="ghost" onclick={() => copy(st.interactionsUrl!)}><Copy class="size-4" /></Button>
										</div>
									{/if}
									{#if !st.siteIsPublic}
										<p class="mt-1 text-xs text-destructive">
											This site runs on localhost — Discord can't reach it. Works on the deployed site.
										</p>
									{/if}
								</li>
								<li>
									<b>Register the commands</b> — tells Discord that <code>/roster</code>, <code>/hero</code> and
									<code>/leaderboard</code> exist. Run again whenever commands change.
									<div class="mt-1 flex flex-wrap items-center gap-2">
										<Button size="sm" onclick={registerCommands} disabled={registering || !st.bot.applicationId}>
											{registering ? 'Shouting at Discord…' : 'Register commands'}
										</Button>
										{#if registerResult}<span class="text-xs text-muted-foreground">{registerResult}</span>{/if}
									</div>
								</li>
							</ol>
						</section>
					</div>
				{/if}
			</Tabs.Content>

			<!-- MEMBERS -->
			<Tabs.Content value="members" class="mt-4">
				<ul class="wow-frame divide-y divide-border/50 rounded-lg">
					{#each ov.data?.members ?? [] as m (m.id)}
						<li class="flex items-center justify-between gap-3 p-3 text-sm">
							<div class="min-w-0">
								<div class="truncate">{m.name ?? m.email}</div>
								<div class="truncate text-xs text-muted-foreground">{m.email} · since {ago(m.createdAt)}</div>
							</div>
							{#if m.role === 'admin'}
								<Badge>Guild Master</Badge>
							{:else}
								<div class="flex items-center gap-2">
									<Badge variant="secondary">Member</Badge>
									<Button
										size="sm"
										variant="ghost"
										onclick={() => run(client.mutation(api.admin.revokeMember, { roleId: m.id }), 'Membership revoked. Cold.')}
										>Revoke</Button
									>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</Tabs.Content>
		</Tabs.Root>
	</div>
{/if}
