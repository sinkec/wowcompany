<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import Tip from '#lib/components/wow/Tip.svelte';
	import { ask } from '#lib/confirm.svelte.js';
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
	import Inbox from '@lucide/svelte/icons/inbox';
	import Users from '@lucide/svelte/icons/users';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Newspaper from '@lucide/svelte/icons/newspaper';
	import Trophy from '@lucide/svelte/icons/trophy';
	import Plug from '@lucide/svelte/icons/plug';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import SquareSlash from '@lucide/svelte/icons/square-slash';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Globe from '@lucide/svelte/icons/globe';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import House from '@lucide/svelte/icons/house';
	import Plus from '@lucide/svelte/icons/plus';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import EventsAdmin from '#lib/components/admin/EventsAdmin.svelte';
	import HeroesAdmin from '#lib/components/admin/HeroesAdmin.svelte';
	import RunDeletionRequests from '#lib/components/admin/RunDeletionRequests.svelte';
	import SimpleSelect from '#lib/components/form/SimpleSelect.svelte';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import TeamName from '#lib/components/admin/TeamName.svelte';
	import { SOCIAL_KINDS, parseConvos, parseQuips } from '#convex/lib/siteContent.js';
	import Archive from '@lucide/svelte/icons/archive';
	import { onMount } from 'svelte';
	import { attempt } from '#lib/errors.js';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { FIELD_LABELS, ago, classColor, fmt } from '#lib/wow.js';
	import { POST_FIELDS } from '#convex/lib/discordEmbed.js';
	import { EVENT_FIELDS, RUN_FIELDS } from '#convex/lib/settings.js';

	const auth = useAuth();
	const client = useConvexClient();
	const me = useQuery(api.auth.me, () => (auth.isAuthenticated ? {} : 'skip'));
	const isAdmin = $derived(me.data?.role === 'admin');
	const ov = useQuery(api.admin.overview, () => (isAdmin ? {} : 'skip'));
	const claims = useQuery(api.claims.listForAdmin, () => (isAdmin ? {} : 'skip'));

	const deletions = useQuery(api.runDeletion.pending, () => (isAdmin ? {} : 'skip'));
	const pendingCount = $derived((claims.data?.pending.length ?? 0) + (deletions.data?.length ?? 0));

	const run = attempt;

	const decide = (claimId: Id<'claims'>, accept: boolean, name: string) =>
		run(
			client.mutation(api.claims.decide, { claimId, accept }),
			accept ? `${name} is in. May god have mercy on their soul.` : `${name} rejected. Brutal.`
		);

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
		run(
			client.mutation(api.admin.updateSettings, { [target]: on ? [...ov.data.fields] : [] }),
			on ? 'All on.' : 'All off.'
		);
	}
	/** Discord: glavno stikalo na vrh, ostalo po vrsti. */
	const fieldsFor = (target: Target) =>
		target === 'discordFields'
			? [
					'lastLogin',
					...(ov.data?.fields ?? []).filter(
						(f) => f !== 'lastLogin' && !RUN_FIELDS.includes(f) && !EVENT_FIELDS.includes(f)
					),
					// dungeon runi (Companion): objava runa + /parses, neodvisno od objav sej
					...RUN_FIELDS,
					// koledar: objave dogodkov, opomniki, /events (neodvisno od obojega zgoraj)
					...EVENT_FIELDS
				]
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
	const seasonState = useQuery(api.seasons.state, () => (isAdmin ? {} : 'skip'));
	let seasonName = $state('');
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
		const ok = await run(
			client.mutation(api.integrations.setGuild, { guildId: guildInput }),
			'Server ID saved.'
		);
		if (ok !== undefined) guildInput = '';
	}
	const clearIntegration = (what: 'webhook' | 'bot') =>
		run(
			client.mutation(api.integrations.clear, { what }),
			what === 'webhook' ? 'Raven released.' : 'Bot unbound.'
		);
	const sourceLabel = (src: 'web' | 'env' | null) =>
		src === 'web' ? 'set here' : src === 'env' ? 'from env variable' : '';
	let webhookCheck = $state<string | null>(null);
	async function checkWebhook() {
		webhookCheck = 'checking…';
		const r = await run(client.action(api.integrations.checkWebhook, {}));
		webhookCheck = !r
			? null
			: r.ok
				? `Alive. Posting as "${r.name}" into channel ${r.channelId}.`
				: r.error;
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
		lastLogin: 'Post session summaries on logout (master switch)',
		runs: 'Post dungeon runs (master switch for run posts)',
		runDetails: 'Run numbers, Company Parses and /parses',
		runDeaths: 'Deaths in run posts',
		runLoot: 'Dice (need/greed) in run posts',
		calendar: 'Event announcements, reminders and our events in /events'
	};
	const runsOn = $derived(ov.data?.settings.discordFields.includes('runs') ?? false);
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

	// --- navigacija: skupine kot v dobrih nadzornih ploščah (vse za Discord na enem mestu)
	type View =
		| 'petitions'
		| 'heroes'
		| 'members'
		| 'web'
		| 'news'
		| 'home'
		| 'events'
		| 'seasons'
		| 'discord'
		| 'discord-posts'
		| 'discord-bot'
		| 'realm'
		| 'diagnostics'
		| 'system';
	const GROUPS: { title: string; items: { key: View; label: string; icon: typeof Users }[] }[] = [
		{
			title: 'Community',
			items: [
				{ key: 'petitions', label: 'Petitions', icon: Inbox },
				{ key: 'heroes', label: 'Heroes', icon: Users },
				{ key: 'members', label: 'Members', icon: ShieldCheck }
			]
		},
		{
			title: 'Website',
			items: [
				{ key: 'web', label: 'Who sees what', icon: Eye },
				{ key: 'home', label: 'Home page', icon: House },
				{ key: 'events', label: 'Events', icon: CalendarDays },
				{ key: 'news', label: 'News', icon: Newspaper },
				{ key: 'seasons', label: 'Parse seasons', icon: Trophy }
			]
		},
		{
			title: 'Discord',
			items: [
				{ key: 'discord', label: 'Connection', icon: Plug },
				{ key: 'discord-posts', label: 'Posts', icon: MessageSquare },
				{ key: 'discord-bot', label: 'Slash commands', icon: SquareSlash }
			]
		},
		{
			title: 'System',
			items: [
				{ key: 'realm', label: 'Realm', icon: Globe },
				{ key: 'system', label: 'Polling & budget', icon: Gauge },
				{ key: 'diagnostics', label: 'Diagnostics', icon: Stethoscope }
			]
		}
	];
	const ALL_VIEWS = GROUPS.flatMap((g) => g.items.map((i) => i.key));
	let view = $state<View>('petitions');
	onMount(() => {
		const h = location.hash.slice(1) as View;
		if (ALL_VIEWS.includes(h)) view = h;
	});
	function go(v: View) {
		view = v;
		history.replaceState(history.state, '', `#${v}`);
	}
	const viewLabel = $derived(
		GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title }))).find(
			(i) => i.key === view
		)
	);

	// --- realm (WoW Forever: regija + ruleset); menjava arhivira vse aktivno
	const realmState = useQuery(api.realms.state, () => (isAdmin ? { now: Date.now() } : 'skip'));
	let pickRegion = $state('eu');
	let pickRuleset = $state('PvP');
	let realmConfirm = $state('');
	let realmDialog = $state(false);
	const pickLabel = $derived(`${pickRegion.toUpperCase()} · ${pickRuleset}`);
	const pickKey = $derived(`${pickRegion}-${pickRuleset.toLowerCase()}`);
	const realmPreview = useQuery(api.realms.preview, () => (isAdmin && realmDialog ? {} : 'skip'));
	const comingBack = $derived(realmState.data?.archives.find((a) => a.key === pickKey) ?? null);
	$effect(() => {
		// ob prvem nalaganju izbira = trenutni realm
		const r = realmState.data?.realm;
		if (r && !realmDialog) {
			pickRegion = r.region;
			pickRuleset = r.ruleset;
		}
	});
	async function saveRealm(first: boolean) {
		const r = await run(
			client.mutation(api.realms.setRealm, {
				region: pickRegion,
				ruleset: pickRuleset,
				...(first ? {} : { confirm: realmConfirm })
			})
		);
		if (!r) return;
		realmDialog = false;
		realmConfirm = '';
		toast.success(
			first
				? `Realm set: ${pickLabel}.`
				: r.restored
					? `Back on ${pickLabel}. Everything restored.`
					: `Moved to ${pickLabel}. The old realm is in the archive for 30 days.`
		);
	}

	// --- naslovnica: šale junakov (posamične + pogovori treh) in povezave na skupnost
	const siteAdmin = useQuery(api.site.forAdmin, () => (isAdmin && view === 'home' ? {} : 'skip'));
	let quipsText = $state('');
	let convosText = $state('');
	let socialsDraft = $state<{ kind: string; url: string; label?: string }[]>([]);
	let siteLoaded = $state(false);
	$effect(() => {
		const d = siteAdmin.data;
		if (d && !siteLoaded) {
			quipsText = d.quips.join('\n');
			convosText = d.convos.map((c) => c.join('\n')).join('\n\n');
			socialsDraft = d.socials.map((x) => ({ ...x }));
			siteLoaded = true;
		}
	});
	// sproti: kateri pogovor nima treh vrstic (preden gre na strežnik)
	const convoCheck = $derived(parseConvos(convosText).error);
	const quipCount = $derived(parseQuips(quipsText).length);
	async function saveQuips() {
		const r = await run(
			client.mutation(api.site.saveQuips, { quips: quipsText, convos: convosText })
		);
		if (r) toast.success(`${r.quips} lines and ${r.convos} conversations. The heroes rehearse.`);
	}
	async function saveSocials() {
		const r = await run(
			client.mutation(api.site.saveSocials, { socials: $state.snapshot(socialsDraft) })
		);
		if (r !== undefined) toast.success(`${r} link${r === 1 ? '' : 's'} saved.`);
	}
	async function resetQuips() {
		if (
			!siteAdmin.data ||
			!(await ask({
				title: 'Replace both lists with the built-in jokes?',
				description: 'Your own lines are gone once you save.',
				confirm: 'Replace'
			}))
		)
			return;
		quipsText = siteAdmin.data.defaults.quips.join('\n');
		convosText = siteAdmin.data.defaults.convos.map((c) => c.join('\n')).join('\n\n');
	}

	// --- diagnostika addona (opt-in, pošlje Companion)
	const diagList = useQuery(api.diagnostics.list, () =>
		isAdmin && view === 'diagnostics' ? {} : 'skip'
	);
	let diagOpen = $state<Id<'diagnostics'> | null>(null);
	const diagReport = useQuery(api.diagnostics.get, () =>
		isAdmin && diagOpen ? { id: diagOpen } : 'skip'
	);
	const pretty = (j: string | null | undefined) => {
		if (!j) return '';
		try {
			return JSON.stringify(JSON.parse(j), null, 2);
		} catch {
			return j;
		}
	};
	function downloadDiag(name: string) {
		const blob = new Blob([pretty(diagReport.data)], { type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `wowcompany-diagnostics-${name}.json`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	// --- news
	const newsAdmin = useQuery(api.news.adminList, () => (isAdmin && view === 'news' ? {} : 'skip'));
	let newsTitle = $state('');
	let newsText = $state('');
	let newsUrl = $state('');
	let refreshingNews = $state(false);
	async function postNews(e: SubmitEvent) {
		e.preventDefault();
		const r = await run(
			client.mutation(api.news.post, {
				title: newsTitle,
				summary: newsText,
				...(newsUrl.trim() ? { url: newsUrl } : {})
			}),
			'Posted. The tavern crier is shouting it.'
		);
		if (r) newsTitle = newsText = newsUrl = '';
	}
	async function refreshNews() {
		refreshingNews = true;
		const r = await run(client.action(api.news.refreshNow, {}));
		refreshingNews = false;
		if (r)
			toast[r.ok ? 'success' : 'error'](
				r.ok ? `${r.found} articles found, ${r.added} new.` : 'Blizzard news page did not answer.'
			);
	}

	// --- settings
	const INTERVALS = [1, 2, 5, 10, 15, 30, 60];
	const pct = (v: number, limit: number) => Math.min(100, Math.round((v / limit) * 100));
</script>

<svelte:head><title>Guild Master's Office — WowCompany</title></svelte:head>

{#if auth.isLoading || (auth.isAuthenticated && me.isLoading)}
	<div class="h-60 animate-pulse rounded-lg bg-muted"></div>
{:else if !isAdmin}
	<Card.Root
	 class="mx-auto flex max-w-lg flex-col items-center gap-3 p-12 text-center"
	>
		<ShieldAlert class="size-12 text-destructive" />
		<h1 class="text-2xl font-bold">Guild Master only</h1>
		<p class="text-muted-foreground">
			You are not the Guild Master. The guards have been notified. They don't care, but still.
		</p>
	</Card.Root>
{:else}
	<div class="space-y-6">
		<section>
			<h1 class="page-title">The Guild Master's Office</h1>
			<p class="page-lead">
				Judge petitions, banish heroes, decide who sees what. Power corrupts. Enjoy.
			</p>
		</section>

		<div class="grid gap-6 md:grid-cols-[14rem_1fr]">
			<nav class="flex gap-4 overflow-x-auto md:flex-col md:gap-5" aria-label="Office sections">
				{#each GROUPS as g (g.title)}
					<div class="shrink-0">
						<div class="eyebrow mb-1 px-3">{g.title}</div>
						<div class="flex gap-1 md:flex-col">
							{#each g.items as it (it.key)}
								<button
									onclick={() => go(it.key)}
									aria-current={view === it.key ? 'page' : undefined}
									class="flex min-h-10 shrink-0 items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors {view ===
									it.key
										? 'bg-accent/70 text-foreground md:border-l-2 md:border-primary'
										: 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
								>
									<it.icon class="size-4 shrink-0 {view === it.key ? 'text-primary' : ''}" />
									<span class="font-medium">{it.label}</span>
									{#if it.key === 'petitions' && pendingCount}<Badge class="ml-auto h-5 px-1.5"
											>{pendingCount}</Badge
										>{/if}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</nav>

			<div class="min-w-0 space-y-4">
				{#if realmState.data && !realmState.data.realm && view !== 'realm'}
					<Alert.Root class="border-primary/60 bg-primary/10">
						<Globe class="text-primary" />
						<Alert.Title>Choose your realm first.</Alert.Title>
						<Alert.Description>
							One realm per company – heroes from other realms are turned away.
						</Alert.Description>
						<Alert.Action>
							<Button size="sm" onclick={() => go('realm')}>Pick realm</Button>
						</Alert.Action>
					</Alert.Root>
				{/if}
				{#if viewLabel}
					<div>
						<div class="eyebrow">{viewLabel.group}</div>
						<h2 class="section-title">{viewLabel.label}</h2>
					</div>
				{/if}

				<!-- PETITIONS -->
				{#if view === 'petitions'}<div class="space-y-6">
						<RunDeletionRequests rows={deletions.data ?? []} />
						{#if !claims.data?.pending.length && deletions.data?.length}
							<!-- samo prošnje za izbris -->
						{:else if !claims.data?.pending.length}
							<p class="wow-frame rounded-lg p-8 text-center text-muted-foreground italic">
								No petitions. Nobody wants to join. Can't imagine why.
							</p>
						{:else}
							<ul class="grid gap-3 md:grid-cols-2">
								{#each claims.data.pending as c (c.id)}
									<li class="wow-frame space-y-3 rounded-lg p-4">
										<div>
											<div
												class="font-display text-lg font-semibold"
												style="color: {classColor(c.preview.classId)}"
											>
												{c.name}
											</div>
											<div class="text-sm">
												Level {c.preview.level}
												{c.preview.race}
												{c.preview.className}
											</div>
											<div class="text-xs text-muted-foreground">
												{c.preview.guild ? `<${c.preview.guild}> · ` : 'no guild · '}by {c.email} · {ago(
													c.createdAt
												)}
											</div>
										</div>
										<div class="flex gap-2">
											<Button size="sm" onclick={() => decide(c.id, true, c.name)}
												><Check class="size-4" /> Accept</Button
											>
											<Button size="sm" variant="ghost" onclick={() => decide(c.id, false, c.name)}
												><X class="size-4" /> Reject</Button
											>
										</div>
									</li>
								{/each}
							</ul>
						{/if}
						{#if claims.data?.decided.length}
							<section>
								<h2 class="card-title mb-2">Recently judged</h2>
								<ul class="space-y-1 text-sm">
									{#each claims.data.decided as c (c.id)}
										<li class="flex justify-between gap-3">
											<span>{c.name} <span class="text-muted-foreground">· {c.email}</span></span>
											<span class={c.status === 'accepted' ? 'text-[#1eff00]' : 'text-destructive'}>
												{c.status}
												{ago(c.decidedAt)}
											</span>
										</li>
									{/each}
								</ul>
							</section>
						{/if}
					</div>{/if}

				<!-- HEROES -->
				{#if view === 'heroes'}<HeroesAdmin players={ov.data?.players ?? []} />{/if}

				<!-- VISIBILITY -->
				{#if view === 'web' || view === 'discord-posts'}<div class="max-w-3xl space-y-3">
						<p class="section-lead">
							{view === 'web' ? 'What visitors see.' : 'What Discord gets.'} Filtering happens on the
							server, so no sneaky devtools peeking. Hero names and profile links are always shown — a
							page about nobody would be weird.
						</p>
						<div class="grid gap-4">
							{#each VIS_COLUMNS.filter((c) => c.target === (view === 'web' ? 'publicFields' : 'discordFields')) as col (col.target)}
								<Card.Root class="p-4">
									<div class="flex flex-wrap items-start justify-between gap-2">
										<div>
											<h2 class="card-title">{col.title}</h2>
											<p class="text-xs text-muted-foreground">{col.note}</p>
										</div>
										<div class="flex gap-1">
											<Button size="sm" variant="secondary" onclick={() => setAll(col.target, true)}
												>Select all</Button
											>
											<Button size="sm" variant="ghost" onclick={() => setAll(col.target, false)}
												>Deselect all</Button
											>
										</div>
									</div>

									<div class="mt-3">
										{#each fieldsFor(col.target) as f, i (f)}
											{@const on = ov.data?.settings[col.target].includes(f) ?? false}
											{@const master =
												col.target === 'discordFields' && (f === 'lastLogin' || f === 'runs')}
											{@const isRun = RUN_FIELDS.includes(f)}
											{@const isEvent = EVENT_FIELDS.includes(f)}
											{#if col.target === 'discordFields' && f === 'runs'}
												<h3 class="eyebrow mt-5 mb-2 text-primary">Dungeon runs (Companion)</h3>
												<p class="mb-2 text-xs text-muted-foreground">
													A post 5 minutes after a run is uploaded, and the /parses command.
													Independent of the session posts above.
												</p>
											{/if}
											{#if col.target === 'discordFields' && f === 'calendar'}
												<h3 class="eyebrow mt-5 mb-2 text-primary">Calendar</h3>
											{/if}
											<label
												class="flex items-center justify-between gap-3 py-2 text-sm {master
													? 'mb-2 rounded-md border border-primary/50 bg-primary/10 px-3 font-semibold'
													: 'border-b border-border/40 last:border-0'} {col.target ===
													'discordFields' &&
												!master &&
												!isEvent &&
												(isRun ? !runsOn : !sessionsOn)
													? 'opacity-50'
													: ''}"
											>
												<span class="flex flex-wrap items-center gap-2">
													{(col.target === 'discordFields' && DISCORD_LABELS[f]) ||
														FIELD_LABELS[f] ||
														f}
													{#if col.target === 'discordFields' && !master && !isRun && !isEvent && !POST_FIELDS.includes(f)}
														<span
															class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
															>slash commands only</span
														>
													{/if}
												</span>
												<Switch
													checked={on}
													onCheckedChange={(v) => toggleField(col.target, f, v)}
												/>
											</label>
											{#if master && f === 'runs' && !runsOn}
												<p class="-mt-1 mb-2 text-xs text-muted-foreground italic">
													Off: no run posts, and /parses says the parses are classified.
												</p>
											{/if}
											{#if master && f === 'lastLogin' && !sessionsOn}
												<p class="-mt-1 mb-2 text-xs text-muted-foreground italic">
													Master switch is off: nothing gets posted, no matter what's below.
												</p>
											{/if}
										{/each}
									</div>

									{#if col.target === 'discordFields'}
										<div class="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
											<Button
												size="sm"
												onclick={sendTest}
												disabled={!sessionsOn || sendingTest || !integ.data?.webhook.configured}
											>
												<Send class="size-4" />
												{sendingTest ? 'Sending raven…' : 'Send test post'}
											</Button>
											<span class="text-xs text-muted-foreground">
												{#if !integ.data?.webhook.configured}No webhook yet — see Discord →
													Connection.
												{:else if !sessionsOn}Turn on the master switch to send posts.
												{:else}Posts a fake session using exactly these switches.{/if}
											</span>
										</div>
									{/if}
								</Card.Root>
							{/each}
						</div>
					</div>{/if}

				<!-- SETTINGS -->
				{#if view === 'system' || view === 'seasons'}<div class="grid max-w-3xl gap-4">
						{#if ov.data}
							{@const st = ov.data.settings}
							{@const est = ov.data.estimate}
							{#if view === 'system'}
								<Card.Root class="space-y-4 p-4">
									<h2 class="card-title">Blizzard polling</h2>
									<div>
										<div class="mb-2 text-sm">Check every</div>
										<ToggleGroup.Root
											type="single"
											variant="outline"
											size="sm"
											class="flex-wrap"
											aria-label="Check every"
											bind:value={
												() => String(st.pollIntervalSec / 60),
												(v) =>
													v &&
													run(
														client.mutation(api.admin.updateSettings, {
															pollIntervalSec: Number(v) * 60
														})
													)
											}
										>
											{#each INTERVALS as m (m)}
												<ToggleGroup.Item value={String(m)}>{m} min</ToggleGroup.Item>
											{/each}
										</ToggleGroup.Root>
										<p class="mt-2 text-xs text-muted-foreground">
											Blizzard only updates a hero when they log out, so 1–2 minutes means news
											within minutes.
										</p>
									</div>
									<label class="flex items-center justify-between gap-3 text-sm">
										<span
											>Pause polling <span class="text-muted-foreground"
												>(emergency brake for the free tier)</span
											></span
										>
										<Switch
											checked={st.paused}
											onCheckedChange={(v) =>
												run(client.mutation(api.admin.updateSettings, { paused: v }))}
										/>
									</label>
									<div
										class="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm"
									>
										<span>
											Guild roster for name suggestions: {fmt(ov.data.roster.count)} members
											<span class="text-muted-foreground"
												>· {ov.data.roster.fetchedAt
													? ago(ov.data.roster.fetchedAt)
													: 'never'}</span
											>
										</span>
										<Button
											size="sm"
											variant="secondary"
											onclick={() =>
												run(client.action(api.admin.refreshRoster, {}), 'Roster refreshed')}
										>
											<RefreshCw class="size-4" />
										</Button>
									</div>
								</Card.Root>
							{/if}

							{#if view === 'seasons' && seasonState.data}
								{@const ss = seasonState.data}
								<Card.Root class="space-y-3 p-4 lg:col-span-2">
									<h2 class="card-title">Parse seasons</h2>
									<p class="text-xs text-muted-foreground">
										Company Parses are ranked per season. Big patch, new gear, everyone suddenly
										hits harder → start a fresh season so old numbers stop haunting the ladder. Old
										seasons stay viewable.
									</p>
									<div class="text-sm">
										Now: <span class="font-semibold text-primary">{ss.current.name}</span>
										{#if ss.current.startedAt}<span class="text-muted-foreground">
												· since {ago(ss.current.startedAt)}</span
											>{/if}
										· game version
										<span class="tabular-nums">{ss.gamePatch ?? 'unknown (checked daily)'}</span>
									</div>
									{#if ss.suggest}
										<div class="rounded-md border border-primary/60 bg-primary/10 p-3 text-sm">
											Patch {ss.gamePatch} is here (season started on {ss.current.patch}). Start a
											new season?
										</div>
									{/if}
									<form
										class="flex flex-wrap items-center gap-2"
										onsubmit={async (e) => {
											e.preventDefault();
											if (
												!(await ask({
													title: 'Start a new parse season now?',
													description:
														'The ladder starts from zero. The old season stays viewable.',
													confirm: 'Start season'
												}))
											)
												return;
											run(
												client.mutation(
													api.seasons.start,
													seasonName.trim() ? { name: seasonName } : {}
												),
												'New season. Everyone is a nobody again.'
											).then(() => (seasonName = ''));
										}}
									>
										<input
											bind:value={seasonName}
											placeholder="Name (optional, e.g. Season 2 – Ragefire Reckoning)"
											maxlength="40"
											class="h-9 min-w-64 flex-1 rounded-md border border-border bg-background/60 px-3 text-sm"
										/>
										<Button size="sm" type="submit">Start new season</Button>
									</form>
									{#if ss.seasons.length > 1}
										<p class="text-xs text-muted-foreground">
											History: {ss.seasons.map((x) => x.name).join(' · ')}
										</p>
									{/if}
								</Card.Root>
							{/if}

							{#if view === 'system'}
								<Card.Root class="space-y-3 p-4">
									<h2 class="card-title">Convex free tier budget (rough estimate)</h2>
									<p class="text-xs text-muted-foreground">
										{ov.data.activePlayers} heroes · {fmt(est.runsPerMonth)} poll runs / month. Real numbers
										live in the Convex dashboard → Usage.
									</p>
									{#each [{ l: 'Function calls', v: est.functionCalls, max: 1_000_000, u: '' }, { l: 'DB reads by poller', v: est.dbReadMB, max: 1024, u: ' MB' }, { l: 'Action compute', v: est.computeGBh, max: 20, u: ' GB-h' }] as b (b.l)}
										<div>
											<div class="flex justify-between text-sm">
												<span>{b.l}</span><span class="text-muted-foreground tabular-nums"
													>{fmt(b.v, b.u === ' GB-h' ? 2 : 0)}{b.u} / {fmt(b.max)}{b.u}</span
												>
											</div>
											<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-background/60">
												<div
													class="h-full rounded-full {pct(b.v, b.max) > 80
														? 'bg-destructive'
														: 'bg-primary'}"
													style="width: {Math.max(2, pct(b.v, b.max))}%"
												></div>
											</div>
										</div>
									{/each}
								</Card.Root>
							{/if}
						{/if}
					</div>{/if}

				<!-- PORTAL ROOM -->
				{#if view === 'discord' || view === 'discord-bot'}<div class="max-w-3xl space-y-4">
						<p class="section-lead">
							{view === 'discord'
								? 'The webhook posts into one channel: session summaries and dungeon runs.'
								: 'Slash commands like /roster and /parses.'} Everything here can be set from the browser,
							even after deploying. Secrets are write-only: once saved, they never come back to any browser
							— not even yours.
						</p>
						{#if integ.data}
							{@const st = integ.data}
							<div class="grid gap-4">
								<!-- webhook -->
								{#if view === 'discord'}
									<Card.Root class="space-y-3 p-4">
										<div class="flex items-center justify-between gap-2">
											<h2 class="card-title">Messenger Raven</h2>
											{#if st.webhook.configured}
												<Badge class="gap-1"><CircleCheck class="size-3" /> connected</Badge>
											{:else}
												<Badge variant="secondary" class="gap-1"
													><CircleDashed class="size-3" /> not set up</Badge
												>
											{/if}
										</div>
										<p class="text-sm text-muted-foreground">
											Discord webhook that posts session summaries into one channel. One-way: it
											talks, it never listens.
										</p>

										{#if st.webhook.configured}
											<dl
												class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-background/40 p-3 text-xs"
											>
												<dt class="text-muted-foreground">Name</dt>
												<dd>{st.webhook.name ?? '—'}</dd>
												<dt class="text-muted-foreground">Channel ID</dt>
												<dd>{st.webhook.channelId ?? '—'}</dd>
												<dt class="text-muted-foreground">URL</dt>
												<dd class="truncate">{st.webhook.hint}</dd>
												<dt class="text-muted-foreground">Source</dt>
												<dd>{sourceLabel(st.webhook.source)}</dd>
											</dl>
										{/if}

										<ol class="list-decimal space-y-1 pl-5 text-sm">
											<li>
												In Discord, hover the channel → <b>⚙ Edit Channel</b> → <b>Integrations</b>
												→
												<b>Webhooks</b>
												→ <b>New Webhook</b>.
											</li>
											<li>
												Name it (e.g. <i>Tavern Gossip</i>), click <b>Copy Webhook URL</b> and paste it
												below.
											</li>
										</ol>
										<form onsubmit={saveWebhook} class="flex gap-2">
											<Input
												type="password"
												bind:value={webhookInput}
												placeholder={st.webhook.configured
													? 'Paste a new URL to replace'
													: 'https://discord.com/api/webhooks/…'}
												autocomplete="off"
												disabled={savingWebhook}
											/>
											<Button
												type="submit"
												size="sm"
												disabled={savingWebhook || webhookInput.trim().length < 20}
											>
												{savingWebhook ? 'Checking…' : 'Save'}
											</Button>
										</form>
										<div class="flex flex-wrap items-center gap-2">
											<Button
												size="sm"
												variant="secondary"
												onclick={checkWebhook}
												disabled={!st.webhook.configured}>Check raven</Button
											>
											{#if st.webhook.source === 'web'}
												<Button
													size="sm"
													variant="ghost"
													onclick={() => clearIntegration('webhook')}>Remove</Button
												>
											{/if}
											{#if webhookCheck}<span class="text-xs text-muted-foreground"
													>{webhookCheck}</span
												>{/if}
										</div>
									</Card.Root>
								{/if}
								<!-- app / slash commands -->
								{#if view === 'discord-bot'}
									<Card.Root class="space-y-3 p-4">
										<div class="flex items-center justify-between gap-2">
											<h2 class="card-title">Discord Bot (slash commands)</h2>
											{#if st.bot.configured && st.bot.publicKeySet}
												<Badge class="gap-1"><CircleCheck class="size-3" /> bound</Badge>
											{:else}
												<Badge variant="secondary" class="gap-1"
													><CircleDashed class="size-3" /> not set up</Badge
												>
											{/if}
										</div>
										<p class="text-sm text-muted-foreground">
											Lets people type <code>/roster</code>, <code>/hero</code>,
											<code>/leaderboard</code>, <code>/parses</code>, <code>/events</code> and
											<code>/news</code> in Discord. After an update with new commands, press
											<b>Register commands</b> again. No always-online bot — Discord calls this site over
											HTTP when someone uses a command.
										</p>

										{#if st.bot.configured}
											<dl
												class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-background/40 p-3 text-xs"
											>
												<dt class="text-muted-foreground">Application</dt>
												<dd>{st.bot.applicationName ?? '—'} ({st.bot.applicationId ?? '—'})</dd>
												<dt class="text-muted-foreground">Token</dt>
												<dd>{st.bot.tokenHint}</dd>
												<dt class="text-muted-foreground">Public key</dt>
												<dd>{st.bot.publicKeySet ? 'set' : 'missing'}</dd>
												<dt class="text-muted-foreground">Server ID</dt>
												<dd>{st.guildId ?? 'not set (commands go global, up to 1 h)'}</dd>
												<dt class="text-muted-foreground">Source</dt>
												<dd>{sourceLabel(st.bot.source)}</dd>
											</dl>
										{/if}

										<ol class="list-decimal space-y-3 pl-5 text-sm">
											<li>
												<b>Create the app:</b>
												<a
													href="https://discord.com/developers/applications"
													target="_blank"
													rel="noopener"
													class="text-primary hover:underline">Discord Developer Portal</a
												>
												→ <b>New Application</b> → <b>Bot</b> → <b>Reset Token</b> → paste it here.
												Application ID and public key are fetched automatically.
												<form onsubmit={saveBot} class="mt-2 flex gap-2">
													<Input
														type="password"
														bind:value={tokenInput}
														placeholder={st.bot.configured
															? 'Paste a new token to replace'
															: 'Bot token'}
														autocomplete="off"
														disabled={savingBot}
													/>
													<Button
														type="submit"
														size="sm"
														disabled={savingBot || tokenInput.trim().length < 50}
													>
														{savingBot ? 'Checking…' : 'Save'}
													</Button>
												</form>
												{#if st.bot.source === 'web'}
													<Button
														size="sm"
														variant="ghost"
														class="mt-1"
														onclick={() => clearIntegration('bot')}>Remove bot</Button
													>
												{/if}
											</li>
											<li>
												<b>Server ID</b> — taken from the webhook automatically. Different server?
												Right-click it in Discord →
												<b>Copy Server ID</b> (needs Developer Mode):
												<form onsubmit={saveGuild} class="mt-2 flex gap-2">
													<Input
														bind:value={guildInput}
														placeholder={st.guildId ?? '123456789012345678'}
														inputmode="numeric"
													/>
													<Button
														type="submit"
														size="sm"
														variant="secondary"
														disabled={guildInput.trim().length < 17}>Save</Button
													>
												</form>
											</li>
											<li>
												<b>Add the bot to the server</b> (needs “Manage Server” on that Discord). It
												only gets the
												<i>applications.commands</i> permission — it can't read or post messages on
												its own:
												{#if st.inviteUrl}
													<div class="mt-1">
														<a
															href={st.inviteUrl}
															target="_blank"
															rel="noopener"
															class={buttonVariants({ size: 'sm' })}
														>
															<ExternalLink class="size-4" /> Invite to Discord
														</a>
													</div>
												{:else}
													<span class="text-muted-foreground"> save the bot token first.</span>
												{/if}
											</li>
											<li>
												<b>Interactions Endpoint URL</b> — paste into Developer Portal → your app →
												General Information → Save:
												{#if st.interactionsUrl}
													<div class="mt-1 flex items-center gap-2">
														<code class="truncate rounded bg-muted px-2 py-1 text-xs"
															>{st.interactionsUrl}</code
														>
														<Button
															size="sm"
															variant="ghost"
															onclick={() => copy(st.interactionsUrl!)}
															><Copy class="size-4" /></Button
														>
													</div>
												{/if}
												{#if !st.siteIsPublic}
													<p class="mt-1 text-xs text-destructive">
														This site runs on localhost — Discord can't reach it. Works on the
														deployed site.
													</p>
												{/if}
											</li>
											<li>
												<b>Register the commands</b> — tells Discord that <code>/roster</code>,
												<code>/hero</code>
												and
												<code>/leaderboard</code> exist. Run again whenever commands change.
												<div class="mt-1 flex flex-wrap items-center gap-2">
													<Button
														size="sm"
														onclick={registerCommands}
														disabled={registering || !st.bot.applicationId}
													>
														{registering ? 'Shouting at Discord…' : 'Register commands'}
													</Button>
													{#if registerResult}<span class="text-xs text-muted-foreground"
															>{registerResult}</span
														>{/if}
												</div>
											</li>
										</ol>
									</Card.Root>
								{/if}
							</div>
						{/if}
					</div>{/if}

				<!-- MEMBERS -->
				{#if view === 'members'}<div>
						<ul class="wow-frame divide-y divide-border/50 rounded-lg">
							{#each ov.data?.members ?? [] as m (m.id)}
								<li class="flex items-center justify-between gap-3 p-3 text-sm">
									<div class="min-w-0">
										<div class="truncate">{m.name ?? m.email}</div>
										<div class="truncate text-xs text-muted-foreground">
											{m.email} · since {ago(m.createdAt)}
										</div>
									</div>
									{#if m.role === 'admin'}
										<Badge>Guild Master</Badge>
									{:else}
										<div class="flex items-center gap-2">
											<Badge variant="secondary">Member</Badge>
											<Button
												size="sm"
												variant="ghost"
												onclick={() =>
													run(
														client.mutation(api.admin.revokeMember, { roleId: m.id }),
														'Membership revoked. Cold.'
													)}>Revoke</Button
											>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					</div>{/if}
				{#if view === 'realm'}
					<div class="max-w-3xl space-y-4">
						<p class="section-lead">
							WoW Forever has no realm list in Blizzard's API: a realm here is a region plus a
							ruleset. Heroes from another region or ruleset can't join. Switching moves every hero,
							run and ladder of the current realm into a read-only archive for 30 days (members can
							browse and download it); coming back within 30 days restores everything.
						</p>
						{#if realmState.data}
							{@const rs = realmState.data}
							<Card.Root class="p-5 space-y-4">
								<div>
									<div class="eyebrow">Current realm</div>
									<div class="section-title">{rs.realm ? rs.realm.label : 'Not chosen yet'}</div>
									{#if rs.realm}<p class="section-lead">since {ago(rs.realm.since)}</p>{/if}
								</div>
								<div class="flex flex-wrap items-end gap-3">
									<label class="space-y-1 text-sm">
										<span class="stat-label block">Region</span>
										<SimpleSelect
											bind:value={pickRegion}
											class="w-28"
											options={rs.regions.map((r) => ({ value: r, label: r.toUpperCase() }))}
										/>
									</label>
									<label class="space-y-1 text-sm">
										<span class="stat-label block">Ruleset</span>
										<SimpleSelect
											bind:value={pickRuleset}
											class="w-36"
											options={rs.rulesets.map((r) => ({ value: r, label: r }))}
										/>
									</label>
									{#if !rs.realm}
										<Button onclick={() => saveRealm(true)}>Set realm: {pickLabel}</Button>
									{:else if rs.realm.key !== pickKey}
										<Button variant="destructive" onclick={() => (realmDialog = true)}
											>Move to {pickLabel}…</Button
										>
									{/if}
								</div>
							</Card.Root>

							{#if realmDialog && rs.realm}
								<Card.Root class="p-5 space-y-3 border-destructive/70">
									<h3 class="card-title text-destructive">
										Move the company from {rs.realm.label} to {pickLabel}?
									</h3>
									{#if realmPreview.data}
										<p class="text-sm">
											Into the archive of <b>{rs.realm.label}</b>: <b>{realmPreview.data.heroes}</b>
											heroes,
											<b>{realmPreview.data.runs}</b> dungeon runs and their parse ladders. Members can
											read and download it for 30 days, then it is deleted for good.
										</p>
									{:else}
										<p class="text-sm text-muted-foreground">Counting the bodies…</p>
									{/if}
									{#if comingBack}
										<p class="rounded-md border border-primary/50 bg-primary/10 p-2 text-sm">
											Welcome back: the archive of {pickLabel} ({comingBack.heroes} heroes, {comingBack.runs}
											runs,
											{comingBack.daysLeft} days left) will be restored.
										</p>
									{:else}
										<p class="text-sm">
											{pickLabel} starts empty with a new season. Heroes have to be added again.
										</p>
									{/if}
									<label class="block space-y-1 text-sm">
										<span>Type <b>{pickLabel}</b> to confirm</span>
										<Input bind:value={realmConfirm} placeholder={pickLabel} autocomplete="off" />
									</label>
									<div class="flex gap-2">
										<Button
											variant="destructive"
											disabled={realmConfirm.trim().toLowerCase() !== pickLabel.toLowerCase()}
											onclick={() => saveRealm(false)}>Archive and move</Button
										>
										<Button
											variant="ghost"
											onclick={() => ((realmDialog = false), (realmConfirm = ''))}>Stay</Button
										>
									</div>
								</Card.Root>
							{/if}

							{#if rs.archives.length}
								<Card.Root class="p-5 space-y-2">
									<h3 class="card-title flex items-center gap-2">
										<Archive class="size-4" /> Archives
									</h3>
									{#each rs.archives as a (a.key)}
										<div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
											<span><b>{a.label}</b> · {a.heroes} heroes · {a.runs} runs</span>
											<span class={a.daysLeft <= 7 ? 'text-destructive' : 'text-muted-foreground'}
												>deleted in {a.daysLeft} day{a.daysLeft === 1 ? '' : 's'}</span
											>
										</div>
									{/each}
									<a href="/archive" class="text-sm text-primary hover:underline"
										>Open the archive →</a
									>
								</Card.Root>
							{/if}
						{/if}
					</div>
				{/if}

				{#if view === 'events'}
					<EventsAdmin discordOn={ov.data?.settings.discordFields.includes('calendar') ?? false} />
				{/if}

				{#if view === 'home'}
					<div class="max-w-3xl space-y-4">
						<TeamName current={siteAdmin.data?.teamName ?? null} />
						<Card.Root class="p-5 space-y-3">
							<div>
								<h3 class="card-title">Community links</h3>
								<p class="section-lead">
									Shown as buttons in the hero and as icons in the footer. https links only.
								</p>
							</div>
							{#each socialsDraft as row, i (i)}
								<div class="flex flex-wrap gap-2">
									<SimpleSelect
										bind:value={row.kind}
										class="w-36"
										label="Network"
										options={SOCIAL_KINDS.map((k) => ({ value: k, label: k }))}
									/>
									<Input
										bind:value={row.url}
										placeholder="https://discord.gg/…"
										class="min-w-56 flex-1"
									/>
									<Input bind:value={row.label} placeholder="Label (optional)" class="w-44" />
									<Button
										size="sm"
										variant="ghost"
										onclick={() => (socialsDraft = socialsDraft.filter((_, j) => j !== i))}
										><Trash class="size-4" /></Button
									>
								</div>
							{/each}
							<div class="flex flex-wrap gap-2">
								<Button
									size="sm"
									variant="secondary"
									onclick={() => (socialsDraft = [...socialsDraft, { kind: 'discord', url: '' }])}
									><Plus class="size-4" /> Add link</Button
								>
								<Button size="sm" onclick={saveSocials}>Save links</Button>
							</div>
						</Card.Root>

						<Card.Root class="p-5 space-y-3">
							<div>
								<h3 class="card-title">What the heroes say</h3>
								<p class="section-lead">
									Each visit three random heroes appear. Half the time they get three different
									lines, half the time one conversation – the bubbles pop up in order, like they're
									talking. Placeholders: <code>{'{me}'}</code> = the speaker, <code>{'{1}'}</code>
									<code>{'{2}'}</code> <code>{'{3}'}</code> = first, second, third speaker (first name).
								</p>
							</div>
							<label class="block space-y-1 text-sm">
								<span class="font-medium">Random lines – one per line</span>
								<Textarea bind:value={quipsText} rows={10} class="font-mono text-xs" />
							</label>
							<label class="block space-y-1 text-sm">
								<span class="font-medium"
									>Conversations of three – three lines each, an empty line between conversations</span
								>
								<Textarea bind:value={convosText} rows={12} class="font-mono text-xs" />
							</label>
							<div class="flex flex-wrap gap-2">
								<Button size="sm" onclick={saveQuips} disabled={!!convoCheck}>Save lines</Button>
								<span
									class="self-center text-xs {convoCheck
										? 'text-destructive'
										: 'text-muted-foreground'}"
								>
									{convoCheck ??
										`${quipCount} lines · ${parseConvos(convosText).convos.length} conversations`}
								</span>
								<Button size="sm" variant="ghost" onclick={resetQuips}
									>Restore built-in jokes</Button
								>
							</div>
						</Card.Root>
					</div>
				{/if}

				{#if view === 'diagnostics'}
					<div class="max-w-4xl space-y-4">
						<p class="section-lead">
							Technical reports from the addon, for development: what the game's meter, loot
							messages and party info look like on this client. Only from players who ticked "Help
							development" in the addon (Logging tab). Shapes and numbers, no names. The last 3 per
							device are kept.
						</p>
						<ul class="panel divide-y divide-border/40 !p-0">
							{#each diagList.data ?? [] as d (d.id)}
								<li>
									<button
										class="flex w-full flex-wrap items-baseline justify-between gap-2 p-3 text-left text-sm hover:bg-accent/30 {diagOpen ===
										d.id
											? 'bg-accent/40'
											: ''}"
										onclick={() => (diagOpen = diagOpen === d.id ? null : d.id)}
									>
										<span><b>{d.user}</b> · {d.device}</span>
										<span class="text-xs text-muted-foreground">
											addon {d.addonVersion} · app {d.appVersion} · {ago(d.at)} · {Math.round(
												d.size / 1024
											)} KB
										</span>
									</button>
								</li>
							{:else}
								<li class="p-4 text-sm text-muted-foreground italic">
									No reports yet. Nobody volunteered. Typical.
								</li>
							{/each}
						</ul>
						{#if diagOpen && diagReport.data}
							<Card.Root class="p-5 space-y-2">
								<div class="flex justify-end">
									<Button
										size="sm"
										variant="secondary"
										onclick={() => downloadDiag(String(diagOpen))}>Download JSON</Button
									>
								</div>
								<pre
									class="wow-scroll max-h-[32rem] overflow-auto rounded-md bg-background/60 p-3 text-[11px] leading-snug">{pretty(
										diagReport.data
									)}</pre>
							</Card.Root>
						{/if}
					</div>
				{/if}

				{#if view === 'news'}
					<div class="max-w-3xl space-y-4">
						<p class="section-lead">
							Official WoW Forever news arrive once a day from Blizzard's news page (hotfixes and
							everything mentioning Forever are shown; shop and retail posts come in hidden). New
							game patches and parse seasons post themselves. Add your own below.
						</p>
						<form onsubmit={postNews} class="panel space-y-3">
							<h3 class="card-title">Post company news</h3>
							<Input bind:value={newsTitle} placeholder="Headline" maxlength={140} />
							<Textarea
								bind:value={newsText}
								rows={3}
								maxlength={600}
								placeholder="What happened? Keep it short, they won't read more anyway."
								class="text-sm"
							/>
							<Input bind:value={newsUrl} placeholder="Link (optional, https://… or /runs/…)" />
							<div class="flex flex-wrap items-center gap-2">
								<Button type="submit" size="sm" disabled={newsTitle.trim().length < 3}>Post</Button>
								<Button
									type="button"
									size="sm"
									variant="secondary"
									onclick={refreshNews}
									disabled={refreshingNews}
									><RefreshCw class="size-4 {refreshingNews ? 'animate-spin' : ''}" /> Fetch Blizzard
									news now</Button
								>
							</div>
						</form>
						<ul class="panel divide-y divide-border/40 !p-0">
							{#each newsAdmin.data ?? [] as n (n.id)}
								<li class="flex items-start gap-3 p-3 {n.hidden ? 'opacity-50' : ''}">
									<div class="min-w-0 flex-1">
										<div class="eyebrow">
											{n.source === 'company' ? 'Company' : 'Blizzard'} · {ago(n.publishedAt)}
											{#if n.hidden}· hidden{/if}
										</div>
										<div class="text-sm font-medium">
											{#if n.url}<a
													href={n.url}
													target="_blank"
													rel="noopener noreferrer"
													class="hover:text-primary hover:underline">{n.title}</a
												>{:else}{n.title}{/if}
										</div>
									</div>
									<Tip text={n.hidden ? 'Show on the home page' : 'Hide from the home page'}>
									<Button
										size="sm"
										variant="ghost"
										aria-label={n.hidden ? 'Show on the home page' : 'Hide from the home page'}
										onclick={() =>
											run(client.mutation(api.news.setHidden, { id: n.id, hidden: !n.hidden }))}
									>
										{#if n.hidden}<Eye class="size-4" />{:else}<EyeOff class="size-4" />{/if}
									</Button>
									</Tip>
									{#if n.source === 'company'}
										<Button
											size="sm"
											variant="ghost"
											onclick={() =>
												run(client.mutation(api.news.remove, { id: n.id }), 'Deleted.')}
											><Trash class="size-4" /></Button
										>
									{/if}
								</li>
							{:else}
								<li class="p-4 text-sm text-muted-foreground italic">
									No news yet. Fetch Blizzard's, or make some.
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
