<script lang="ts">
	// Prenos WowCompany Companion: zadnja izdaja "companion-v*" z GitHub Releases (javni API, brez žetona).
	import { onMount } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import Loader from '@lucide/svelte/icons/loader-2';
	import { GITHUB_REPO } from '#lib/site.js';

	type Asset = { name: string; browser_download_url: string; size: number };
	type Release = {
		tag_name: string;
		name: string;
		draft: boolean;
		published_at: string;
		html_url: string;
		assets: Asset[];
	};

	let release = $state<Release | null>(null);
	let status = $state<'loading' | 'ready' | 'none' | 'error'>('loading');
	let os = $state<'windows' | 'linux' | 'other'>('other');

	onMount(async () => {
		const ua = navigator.userAgent.toLowerCase();
		os = ua.includes('windows')
			? 'windows'
			: ua.includes('linux') && !ua.includes('android')
				? 'linux'
				: 'other';
		try {
			const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, {
				headers: { Accept: 'application/vnd.github+json' }
			});
			if (!r.ok) throw new Error(String(r.status));
			const list = (await r.json()) as Release[];
			release =
				list.find((x) => !x.draft && x.tag_name.startsWith('companion-v') && x.assets.length) ??
				null;
			status = release ? 'ready' : 'none';
		} catch {
			status = 'error';
		}
	});

	const find = (re: RegExp) => release?.assets.find((a) => re.test(a.name)) ?? null;
	const win = $derived(find(/windows.*setup\.exe$/i) ?? find(/\.exe$/i));
	const appimage = $derived(find(/\.AppImage$/));
	const deb = $derived(find(/\.deb$/));
	const version = $derived(release?.tag_name.replace('companion-v', '') ?? '');
	const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;
	const primary = $derived(os === 'linux' ? appimage : win);
	const primaryLabel = $derived(
		os === 'linux' ? 'Download for Linux (AppImage)' : 'Download for Windows'
	);
</script>

<section id="download" class="wow-frame space-y-4 rounded-lg p-5">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="font-display text-xl font-semibold text-primary">Get the app</h2>
			<p class="text-sm text-muted-foreground">
				Windows and Linux (Steam/Proton, Lutris). Free, small, and only snitches on your party —
				never on strangers.
			</p>
		</div>
		{#if status === 'ready'}<span
				class="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
				>v{version}</span
			>{/if}
	</div>

	{#if status === 'loading'}
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<Loader class="size-4 animate-spin" /> Asking the goblins in the warehouse…
		</div>
	{:else if status === 'none'}
		<p class="text-sm text-muted-foreground italic">
			No release yet. The blacksmith is still hammering it. Check back soon.
		</p>
	{:else if status === 'error'}
		<p class="text-sm text-muted-foreground">
			Couldn't reach GitHub. Grab it directly from
			<a
				class="text-primary hover:underline"
				href="https://github.com/{GITHUB_REPO}/releases"
				target="_blank"
				rel="noopener noreferrer">GitHub Releases</a
			>.
		</p>
	{:else}
		<div class="flex flex-wrap items-center gap-3">
			{#if primary}
				<a
					href={primary.browser_download_url}
					class="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition hover:brightness-110"
				>
					<Download class="size-5" />
					{primaryLabel}
					<span class="text-xs font-normal opacity-80">{mb(primary.size)}</span>
				</a>
			{/if}
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
				{#if win && primary !== win}<a
						class="text-primary hover:underline"
						href={win.browser_download_url}>Windows installer ({mb(win.size)})</a
					>{/if}
				{#if appimage && primary !== appimage}<a
						class="text-primary hover:underline"
						href={appimage.browser_download_url}>Linux AppImage ({mb(appimage.size)})</a
					>{/if}
				{#if deb}<a class="text-primary hover:underline" href={deb.browser_download_url}
						>Linux .deb ({mb(deb.size)})</a
					>{/if}
				<a
					class="text-muted-foreground hover:text-foreground hover:underline"
					href={release?.html_url}
					target="_blank"
					rel="noopener noreferrer">All files</a
				>
			</div>
		</div>

		<ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
			<li>
				<b class="text-foreground">Windows:</b> run the installer. SmartScreen will say “unknown
				publisher” — click
				<i>More info → Run anyway</i>. We can't afford a code-signing certificate; we spent it on
				repair bills.
			</li>
			<li>
				<b class="text-foreground">Linux:</b> AppImage → <code class="text-primary">chmod +x</code>
				and run; or
				<code class="text-primary">sudo apt install ./WowCompany-Companion_*.deb</code>.
			</li>
			<li>
				Open the app → <b class="text-foreground">Sign in with Google</b> → approve the code on this page.
			</li>
			<li>
				In game, <b class="text-foreground">once ever</b>:
				<code class="text-primary">/console advancedCombatLogging 1</code> (better death recaps).
			</li>
			<li>
				<b class="text-foreground">Every session, before the dungeon:</b>
				<code class="text-primary">/combatlog</code>, and
				<code class="text-primary">/chatlog</code> if you want the loot on the portal.
			</li>
			<li>
				<b class="text-foreground">After the dungeon:</b> type both commands again to switch them
				off. The app deletes the old log files when you quit it (tray → Quit). Full guide in the app
				under <i>How to log</i>.
			</li>
		</ol>
	{/if}
</section>
