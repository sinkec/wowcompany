<script lang="ts">
	// Replay runa: zemljevid iz poti partyja (combat log x/y vsaki 2 s – Companion v0.1.12+), igralci
	// z avatarjem in imenom, trak časovnice (vleci / play / pavza / hitrost) in statistika v izbranem
	// trenutku. Zemljevid nariše sam party: hodniki = kjer so hodili (Blizzard slik dungeonov nima).
	import { useQuery } from 'convex-svelte';
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { api } from '#convex/_generated/api.js';
	import { classColor, dungeonTile } from '#lib/wow.js';
	import { fmtNum } from '#lib/runs.js';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import MapIcon from '@lucide/svelte/icons/map';

	type Seg = {
		kind: 'boss' | 'trash';
		name: string;
		startMs: number;
		endMs: number;
		result: 'kill' | 'wipe' | 'none';
	};
	type Death = { slug: string; atMs: number; killer: string | null; killingBlow: string | null };
	type Timeline = {
		bucketMs: number;
		players: { slug: string; damage: number[]; healing: number[]; taken: number[] }[];
	};

	let {
		runId,
		zone,
		instanceId,
		durationMs,
		segments,
		deaths,
		timeline,
		names,
		classes
	}: {
		runId: string;
		zone: string;
		instanceId: number;
		durationMs: number;
		segments: Seg[];
		deaths: Death[];
		timeline: Timeline | null;
		names: Record<string, string>;
		classes: Record<string, number | null>;
	} = $props();

	const rq = useQuery(api.runs.replay, () => ({ id: runId }));

	// --------------------------------------------------------------- podatki
	type Track = { slug: string; ms: number[]; sx: number[]; sy: number[]; map: number[] };
	const tracks = $derived.by((): Track[] => {
		const r = rq.data;
		if (!r) return [];
		return r.players.map((p) => ({
			slug: p.slug,
			ms: p.t.map((b) => b * r.bucketMs),
			// x = sever, y = zahod → zaslon: vzhod desno, sever gor (desetinke jarda → jardi)
			sx: p.y.map((y) => -y / 10),
			sy: p.x.map((x) => -x / 10),
			map: p.map
		}));
	});
	const maps = $derived.by(() => {
		const n = new Map<number, number>();
		for (const t of tracks) for (const m of t.map) n.set(m, (n.get(m) ?? 0) + 1);
		return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
	});
	let pickedMap = $state<number | null>(null);

	// --------------------------------------------------------------- čas
	// ?t=750 (sekunde) → replay se odpre v tistem trenutku (deljiva povezava)
	let t = $state(
		untrack(() =>
			Math.max(0, Math.min(durationMs, Number(page.url.searchParams.get('t') ?? 0) * 1000 || 0))
		)
	);
	let playing = $state(false);
	let speed = $state(16);
	const SPEEDS = [4, 16, 60];
	let raf = 0;
	let last = 0;
	function frame(now: number) {
		if (!playing) return;
		if (last) t = Math.min(durationMs, t + (now - last) * speed);
		last = now;
		if (t >= durationMs) playing = false;
		else raf = requestAnimationFrame(frame);
	}
	function toggle() {
		if (t >= durationMs) t = 0;
		playing = !playing;
		last = 0;
		if (playing) raf = requestAnimationFrame(frame);
	}
	onDestroy(() => cancelAnimationFrame(raf));

	// --------------------------------------------------------------- pozicije v času t
	const GAP = 20_000; // do te luknje (in 40 jardov) ravna črta, daljše po hodnikih
	function idxAt(ms: number[], at: number) {
		let lo = 0;
		let hi = ms.length - 1;
		if (!ms.length || at < ms[0]) return -1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (ms[mid] <= at) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}
	// ---- luknje v podatkih: combat log zapiše pozicijo samo ob bojnih dogodkih, med hojo skozi
	// očiščen del ni ničesar. Pot med zadnjo in naslednjo točko poiščemo po "hodnikih" – vseh točkah,
	// kjer je kdorkoli iz partyja kdaj stal – in lik peljemo po njej. Nemogoča hitrost (duh, teleport) = skok.
	const MAX_SPEED = 12; // jardov/s (tek ~7, s sprintom/hitrostjo več)
	const LINK = 8; // jardov: točke različnih igralcev tako blizu = isti hodnik
	type Graph = { xs: number[]; ys: number[]; adj: number[][]; base: number[] };
	const graphs = $derived.by(() => {
		const out = new Map<number, Graph>();
		const g = (m: number) => {
			let x = out.get(m);
			if (!x) out.set(m, (x = { xs: [], ys: [], adj: [], base: [] }));
			return x;
		};
		// vozlišče = točka sledi; base[track] = indeks prve točke te sledi v grafu njenega zemljevida
		const nodeOf = new Map<string, number>();
		tracks.forEach((tr, ti) => {
			for (let i = 0; i < tr.ms.length; i++) {
				const gr = g(tr.map[i]);
				nodeOf.set(`${ti}:${i}`, gr.xs.length);
				gr.xs.push(tr.sx[i]);
				gr.ys.push(tr.sy[i]);
				gr.adj.push([]);
				if (i > 0 && tr.map[i - 1] === tr.map[i]) {
					const a = nodeOf.get(`${ti}:${i - 1}`)!;
					const b = gr.xs.length - 1;
					const d = Math.hypot(tr.sx[i] - tr.sx[i - 1], tr.sy[i] - tr.sy[i - 1]);
					if (tr.ms[i] - tr.ms[i - 1] <= 8000 && d <= 40) {
						gr.adj[a].push(b);
						gr.adj[b].push(a);
					}
				}
			}
		});
		for (const gr of out.values()) {
			const cell = new Map<string, number[]>();
			const key = (x: number, y: number) => `${Math.floor(x / LINK)}:${Math.floor(y / LINK)}`;
			gr.xs.forEach((x, i) => {
				const k = key(x, gr.ys[i]);
				cell.set(k, [...(cell.get(k) ?? []), i]);
			});
			gr.xs.forEach((x, i) => {
				const cx = Math.floor(x / LINK);
				const cy = Math.floor(gr.ys[i] / LINK);
				for (let dx = -1; dx <= 1; dx++)
					for (let dy = -1; dy <= 1; dy++)
						for (const j of cell.get(`${cx + dx}:${cy + dy}`) ?? [])
							if (j > i && Math.hypot(gr.xs[j] - x, gr.ys[j] - gr.ys[i]) <= LINK) {
								gr.adj[i].push(j);
								gr.adj[j].push(i);
							}
			});
		}
		return { out, nodeOf };
	});
	/** Najkrajša pot po hodnikih (Dijkstra); null = ni povezave. */
	function route(gr: Graph, a: number, b: number): number[] | null {
		const n = gr.xs.length;
		const dist = new Float64Array(n).fill(Infinity);
		const prev = new Int32Array(n).fill(-1);
		const done = new Uint8Array(n);
		dist[a] = 0;
		// majhni grafi (nekaj tisoč točk): preprosta prioritetna vrsta je dovolj
		const heap: [number, number][] = [[0, a]];
		while (heap.length) {
			let bi = 0;
			for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[bi][0]) bi = k;
			const [d, u] = heap.splice(bi, 1)[0];
			if (done[u]) continue;
			done[u] = 1;
			if (u === b) break;
			for (const v of gr.adj[u]) {
				const nd = d + Math.hypot(gr.xs[v] - gr.xs[u], gr.ys[v] - gr.ys[u]);
				if (nd < dist[v]) {
					dist[v] = nd;
					prev[v] = u;
					heap.push([nd, v]);
				}
			}
		}
		if (!Number.isFinite(dist[b])) return null;
		const path: number[] = [];
		for (let v = b; v !== -1; v = prev[v]) path.push(v);
		return path.reverse();
	}
	const routes = new Map<string, { xs: number[]; ys: number[]; len: number[] } | null>();
	function gapRoute(ti: number, tr: Track, i: number) {
		const k = `${ti}:${i}`;
		if (routes.has(k)) return routes.get(k)!;
		const { out, nodeOf } = graphs;
		const gr = out.get(tr.map[i]);
		const a = nodeOf.get(`${ti}:${i}`);
		const b = nodeOf.get(`${ti}:${i + 1}`);
		let r: { xs: number[]; ys: number[]; len: number[] } | null = null;
		const p = gr && a !== undefined && b !== undefined ? route(gr, a, b) : null;
		if (gr && p) {
			const xs = p.map((v) => gr.xs[v]);
			const ys = p.map((v) => gr.ys[v]);
			const len = [0];
			for (let q = 1; q < xs.length; q++)
				len.push(len[q - 1] + Math.hypot(xs[q] - xs[q - 1], ys[q] - ys[q - 1]));
			r = { xs, ys, len };
		}
		routes.set(k, r);
		return r;
	}
	function along(r: { xs: number[]; ys: number[]; len: number[] }, f: number) {
		const want = r.len[r.len.length - 1] * f;
		let q = 1;
		while (q < r.len.length - 1 && r.len[q] < want) q++;
		const seg = r.len[q] - r.len[q - 1] || 1;
		const g = Math.min(1, Math.max(0, (want - r.len[q - 1]) / seg));
		return {
			x: r.xs[q - 1] + (r.xs[q] - r.xs[q - 1]) * g,
			y: r.ys[q - 1] + (r.ys[q] - r.ys[q - 1]) * g
		};
	}
	function posAt(tr: Track, at: number) {
		const i = idxAt(tr.ms, at);
		if (i < 0) return { x: tr.sx[0], y: tr.sy[0], map: tr.map[0], early: true, guess: false };
		const j = i + 1;
		const here = { x: tr.sx[i], y: tr.sy[i], map: tr.map[i], early: false, guess: false };
		if (j >= tr.ms.length || tr.map[j] !== tr.map[i]) return here;
		const dt = tr.ms[j] - tr.ms[i];
		const f = (at - tr.ms[i]) / dt;
		const direct = Math.hypot(tr.sx[j] - tr.sx[i], tr.sy[j] - tr.sy[i]);
		if (dt <= GAP && direct <= 40)
			return {
				...here,
				x: tr.sx[i] + (tr.sx[j] - tr.sx[i]) * f,
				y: tr.sy[i] + (tr.sy[j] - tr.sy[i]) * f
			};
		// luknja: po hodnikih, če je hitrost verjetna; sicer stoji in potem skoči
		const ti = tracks.indexOf(tr);
		const r = gapRoute(ti, tr, i);
		if (r && r.len[r.len.length - 1] / (dt / 1000) <= MAX_SPEED)
			return { ...here, ...along(r, f), guess: true };
		if (direct / (dt / 1000) <= MAX_SPEED)
			return {
				...here,
				x: tr.sx[i] + (tr.sx[j] - tr.sx[i]) * f,
				y: tr.sy[i] + (tr.sy[j] - tr.sy[i]) * f,
				guess: true
			};
		return here;
	}
	/** Mrtev: umrl je in od takrat (+3 s) ni nove točke (oživljen igralec spet pušča sledi). */
	function deadAt(slug: string, at: number) {
		const tr = tracks.find((x) => x.slug === slug);
		for (const d of deaths) {
			if (d.slug !== slug || d.atMs > at) continue;
			const after = tr ? tr.ms.find((m) => m > d.atMs + 3000) : undefined;
			if (after === undefined || after > at) return true;
		}
		return false;
	}

	const now = $derived.by(() => {
		const ps = tracks.map((tr) => ({
			slug: tr.slug,
			...posAt(tr, t),
			dead: deadAt(tr.slug, t),
			stack: 0
		}));
		// imena igralcev, ki stojijo skupaj, gredo eno pod drugo
		const near = 10; // jardov (ne view.span: ta je odvisen od zemljevida, ki je odvisen od pozicij)
		ps.forEach((p, i) => {
			p.stack = ps
				.slice(0, i)
				.filter((q) => q.map === p.map && Math.hypot(q.x - p.x, q.y - p.y) < near).length;
		});
		return ps;
	});
	// prikazan zemljevid: izbran, sicer tisti, na katerem je večina partyja zdaj
	const map = $derived.by(() => {
		if (pickedMap !== null && maps.includes(pickedMap)) return pickedMap;
		const n = new Map<number, number>();
		for (const p of now) n.set(p.map, (n.get(p.map) ?? 0) + 1);
		return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? maps[0] ?? 0;
	});

	// --------------------------------------------------------------- "zemljevid" iz poti
	const pathView = $derived.by(() => {
		const xs: number[] = [];
		const ys: number[] = [];
		for (const tr of tracks)
			tr.map.forEach((m, i) => {
				if (m === map) {
					xs.push(tr.sx[i]);
					ys.push(tr.sy[i]);
				}
			});
		if (!xs.length) return { x: 0, y: 0, w: 100, h: 100, span: 100 };
		const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
		const span = Math.max(40, x1 - x0, y1 - y0);
		const pad = span * 0.08;
		return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad, span };
	});
	// prikazano območje: poti, z naloženo karto pa unija s karto (cel dungeon); med poravnavo zamrznjeno
	const view = $derived.by((): View => {
		if (editing && frozen) return frozen;
		const a = dm.data?.align;
		if (!a || !dm.data) return pathView;
		const h = a.width / dm.data.aspect;
		const x0 = Math.min(pathView.x, a.x);
		const y0 = Math.min(pathView.y, a.y);
		const x1 = Math.max(pathView.x + pathView.w, a.x + a.width);
		const y1 = Math.max(pathView.y + pathView.h, a.y + h);
		return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, span: Math.max(x1 - x0, y1 - y0) * 0.85 };
	});
	/** Hodniki: zaporedne točke istega igralca (blizu v času in prostoru) povezane v črte. */
	const corridors = $derived.by(() => {
		let d = '';
		for (const tr of tracks) {
			for (let i = 1; i < tr.ms.length; i++) {
				if (tr.map[i] !== map || tr.map[i - 1] !== map) continue;
				const dist = Math.hypot(tr.sx[i] - tr.sx[i - 1], tr.sy[i] - tr.sy[i - 1]);
				if (tr.ms[i] - tr.ms[i - 1] > 8000 || dist > 40) {
					d += `M${tr.sx[i].toFixed(1)} ${tr.sy[i].toFixed(1)}h0`;
					continue;
				}
				d += `M${tr.sx[i - 1].toFixed(1)} ${tr.sy[i - 1].toFixed(1)}L${tr.sx[i].toFixed(1)} ${tr.sy[i].toFixed(1)}`;
			}
		}
		return d;
	});
	const trail = (tr: Track) => {
		const from = idxAt(tr.ms, t - 20_000);
		const to = idxAt(tr.ms, t);
		if (to < 0) return '';
		// SVG pot; čez luknjo v podatkih (daleč ali dolgo) se sled prekine – ne riše čez zidove
		let d = '';
		for (let i = Math.max(0, from); i <= to; i++) {
			if (tr.map[i] !== map) continue;
			const cont =
				i > 0 &&
				d !== '' &&
				tr.map[i - 1] === map &&
				tr.ms[i] - tr.ms[i - 1] <= GAP &&
				Math.hypot(tr.sx[i] - tr.sx[i - 1], tr.sy[i] - tr.sy[i - 1]) <= 40;
			d += `${cont ? 'L' : 'M'}${tr.sx[i].toFixed(1)} ${tr.sy[i].toFixed(1)}`;
		}
		return d;
	};

	/** Kje je bil party ob koncu boss boja (središče) – oznaka bossa na zemljevidu. */
	const bossMarks = $derived(
		segments
			.filter((s) => s.kind === 'boss')
			.map((s) => {
				const ps = tracks.map((tr) => posAt(tr, s.endMs)).filter((p) => p.map === map && !p.early);
				if (!ps.length) return null;
				return {
					name: s.name,
					result: s.result,
					startMs: s.startMs,
					x: ps.reduce((n, p) => n + p.x, 0) / ps.length,
					y: ps.reduce((n, p) => n + p.y, 0) / ps.length
				};
			})
			.filter((m) => m !== null)
	);
	const deathMarks = $derived(
		deaths
			.map((d) => {
				const tr = tracks.find((x) => x.slug === d.slug);
				const p = tr ? posAt(tr, d.atMs) : null;
				return p && p.map === map ? { ...d, x: p.x, y: p.y } : null;
			})
			.filter((m) => m !== null)
	);

	// --------------------------------------------------------------- statistika v trenutku t
	const bucket = $derived(timeline ? Math.floor(t / timeline.bucketMs) : 0);
	const stats = $derived.by(() => {
		const rows = tracks.map((tr) => {
			const tl = timeline?.players.find((p) => p.slug === tr.slug);
			const sum = (a: number[] | undefined) =>
				(a ?? []).slice(0, bucket + 1).reduce((n, v) => n + v, 0);
			const secs = (timeline?.bucketMs ?? 10_000) / 1000;
			return {
				slug: tr.slug,
				dps: (tl?.damage[bucket] ?? 0) / secs,
				hps: (tl?.healing[bucket] ?? 0) / secs,
				damage: sum(tl?.damage),
				healing: sum(tl?.healing),
				dead: deadAt(tr.slug, t),
				deaths: deaths.filter((d) => d.slug === tr.slug && d.atMs <= t).length
			};
		});
		return rows.sort((a, b) => b.damage - a.damage);
	});
	const maxDps = $derived(Math.max(1, ...stats.map((s) => s.dps)));
	const seg = $derived(segments.find((s) => s.startMs <= t && t <= s.endMs) ?? null);
	const events = $derived(
		[
			...segments
				.filter((s) => s.kind === 'boss')
				.flatMap((s) => [
					{ at: s.startMs, text: `Pulled ${s.name}`, kind: 'pull' },
					{
						at: s.endMs,
						text: s.result === 'kill' ? `${s.name} is dead` : `Wiped on ${s.name}`,
						kind: s.result === 'kill' ? 'kill' : 'wipe'
					}
				]),
			...deaths.map((d) => ({
				at: d.atMs,
				text: `${names[d.slug] ?? d.slug} died${d.killer ? ` to ${d.killer}` : ''}`,
				kind: 'death'
			}))
		]
			.filter((e) => e.at <= t)
			.sort((a, b) => b.at - a.at)
			.slice(0, 6)
	);

	const clock = (ms: number) => {
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
	const initials = (slug: string) =>
		(names[slug] ?? slug)
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
	let artOk = $state(true);

	// --------------------------------------------------------------- slika zemljevida dungeona
	// Guild Master naloži posnetek igrine karte (M) in ga poravna s potmi; velja za vse rune dungeona.
	const auth = useAuth();
	const client = useConvexClient();
	const me = useQuery(api.auth.me, () => (auth.isAuthenticated ? {} : 'skip'));
	const isAdmin = $derived(me.data?.role === 'admin');
	const dm = useQuery(api.dungeonMaps.get, () => ({ instanceId }));
	type Align = { x: number; y: number; width: number; rotate: number };
	let editing = $state(false);
	let draft = $state<Align | null>(null);
	type View = { x: number; y: number; w: number; h: number; span: number };
	let frozen = $state<View | null>(null);
	let showPaths = $state(true);
	const shownAlign = $derived(editing && draft ? draft : (dm.data?.align ?? null));
	const imgH = $derived(shownAlign && dm.data ? shownAlign.width / dm.data.aspect : 0);
	const fitAlign = (aspect: number): Align => {
		const v = view;
		const width = Math.max(v.w, v.h * aspect);
		return { x: v.x + (v.w - width) / 2, y: v.y + (v.h - width / aspect) / 2, width, rotate: 0 };
	};
	function startEdit() {
		if (!dm.data) return;
		frozen = { ...view };
		draft = { ...dm.data.align };
		editing = true;
	}
	async function saveAlign() {
		if (!draft) return;
		await client.mutation(api.dungeonMaps.setAlign, { instanceId, align: $state.snapshot(draft) });
		editing = false;
		frozen = null;
		toast.success('Map aligned. Cartographers everywhere weep with joy.');
	}
	let uploading = $state(false);
	async function upload(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		uploading = true;
		try {
			// pomanjšaj v WebP (≤ 1600 px) – manj prostora in prenosa na brezplačnem paketu
			const bmp = await createImageBitmap(file);
			const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
			const c = document.createElement('canvas');
			c.width = Math.round(bmp.width * k);
			c.height = Math.round(bmp.height * k);
			c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
			const blob = await new Promise<Blob>((res, rej) =>
				c.toBlob(
					(b) => (b ? res(b) : rej(new Error('Could not read the image.'))),
					'image/webp',
					0.82
				)
			);
			const url = await client.mutation(api.dungeonMaps.uploadUrl, {});
			const r = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': blob.type },
				body: blob
			});
			if (!r.ok) throw new Error(`Upload failed (${r.status}).`);
			const { storageId } = await r.json();
			const aspect = c.width / c.height;
			await client.mutation(api.dungeonMaps.save, {
				instanceId,
				zone,
				storageId,
				aspect,
				align: fitAlign(aspect)
			});
			toast.success('Map uploaded. Now line it up with the paths.');
			setTimeout(startEdit, 600);
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			uploading = false;
		}
	}
</script>

{#if rq.isLoading}
	<div class="h-96 animate-pulse rounded-lg bg-muted"></div>
{:else if !rq.data}
	<p class="panel text-center text-sm text-muted-foreground italic">
		No replay for this run. Runs recorded with Companion v0.1.12 or newer have one.
	</p>
{:else}
	<div class="grid gap-4 lg:grid-cols-[1fr_20rem]">
		<!-- zemljevid -->
		<section class="panel relative isolate overflow-hidden !p-0">
			{#if artOk}
				<img
					src={dungeonTile(zone)}
					alt=""
					class="absolute inset-0 -z-10 size-full object-cover opacity-15 blur-[2px]"
					onerror={() => (artOk = false)}
				/>
			{/if}
			<div class="flex items-center justify-between gap-2 px-4 pt-3">
				<div>
					<div class="eyebrow">
						{seg ? (seg.kind === 'boss' ? 'Boss fight' : 'Trash') : 'On the move'}
					</div>
					<div class="card-title">{seg?.kind === 'boss' ? seg.name : zone}</div>
				</div>
				<div class="flex flex-wrap items-center justify-end gap-1 text-xs">
					{#if dm.data && !editing}
						<button
							class="rounded border px-2 py-0.5 {showPaths
								? 'border-primary text-primary'
								: 'border-border text-muted-foreground'}"
							onclick={() => (showPaths = !showPaths)}>Paths</button
						>
					{/if}
					{#if isAdmin && !editing}
						<label
							class="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
							title="Screenshot of the in-game map (M) of this dungeon"
						>
							<MapIcon class="size-3" />
							{uploading ? 'Uploading…' : dm.data ? 'New map' : 'Add map image'}
							<input
								type="file"
								accept="image/*"
								class="hidden"
								onchange={upload}
								disabled={uploading}
							/>
						</label>
						{#if dm.data}
							<button
								class="rounded border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
								onclick={startEdit}>Align</button
							>
						{/if}
					{/if}
				</div>
				{#if maps.length > 1}
					<div class="flex gap-1 text-xs">
						{#each maps as m, i (m)}
							<button
								class="rounded border px-2 py-0.5 {map === m
									? 'border-primary text-primary'
									: 'border-border text-muted-foreground'}"
								onclick={() => (pickedMap = pickedMap === m ? null : m)}>Floor {i + 1}</button
							>
						{/each}
					</div>
				{/if}
			</div>
			<svg
				viewBox="{view.x} {view.y} {view.w} {view.h}"
				class="aspect-[4/3] w-full"
				role="img"
				aria-label="Party positions on the dungeon map"
			>
				<!-- karta dungeona (posnetek igrine karte, poravnan s potmi) -->
				{#if dm.data && shownAlign}
					<image
						href={dm.data.url}
						x={shownAlign.x}
						y={shownAlign.y}
						width={shownAlign.width}
						height={imgH}
						preserveAspectRatio="none"
						opacity={editing ? 0.75 : 0.9}
						transform="rotate({shownAlign.rotate} {shownAlign.x +
							shownAlign.width / 2} {shownAlign.y + imgH / 2})"
					/>
				{/if}
				<!-- hodniki -->
				{#if showPaths || !dm.data}
					<path
						d={corridors}
						fill="none"
						stroke="oklch(0.62 0.1 80 / 0.16)"
						stroke-width={view.span * 0.035}
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
					<path
						d={corridors}
						fill="none"
						stroke="oklch(0.85 0.08 85 / 0.25)"
						stroke-width={view.span * 0.004}
						stroke-linecap="round"
					/>
				{/if}
				<!-- bossi -->
				{#each bossMarks as b (b.name + b.startMs)}
					<g opacity={t >= b.startMs ? 1 : 0.45}>
						<circle
							cx={b.x}
							cy={b.y}
							r={view.span * 0.022}
							fill={b.result === 'kill' ? 'oklch(0.8 0.13 85 / 0.25)' : 'oklch(0.6 0.2 27 / 0.25)'}
							stroke={b.result === 'kill' ? 'oklch(0.8 0.13 85)' : 'oklch(0.6 0.2 27)'}
							stroke-width={view.span * 0.003}
						/>
						<text
							x={b.x}
							y={b.y - view.span * 0.03}
							text-anchor="middle"
							font-size={view.span * 0.028}
							class="fill-primary font-display"
							paint-order="stroke"
							stroke="black"
							stroke-width={view.span * 0.006}>☠ {b.name}</text
						>
					</g>
				{/each}
				<!-- smrti -->
				{#each deathMarks as d, i (i)}
					{#if d.atMs <= t}
						<text
							x={d.x}
							y={d.y}
							text-anchor="middle"
							dominant-baseline="central"
							font-size={view.span * 0.03}
							fill="oklch(0.65 0.22 27)"
							paint-order="stroke"
							stroke="black"
							stroke-width={view.span * 0.005}>✖</text
						>
					{/if}
				{/each}
				<!-- sledi -->
				{#each tracks as tr (tr.slug)}
					<path
						d={trail(tr)}
						fill="none"
						stroke={classColor(classes[tr.slug] ?? undefined)}
						stroke-opacity="0.55"
						stroke-width={view.span * 0.005}
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				{/each}
				<!-- igralci -->
				{#each now as p (p.slug)}
					{#if p.map === map}
						{@const c = classColor(classes[p.slug] ?? undefined)}
						{@const r = view.span * 0.018}
						<g transform="translate({p.x} {p.y})" opacity={p.early ? 0.35 : p.dead ? 0.6 : 1}>
							<circle {r} fill="oklch(0.16 0.012 60)" stroke={c} stroke-width={r * 0.28} />
							<text
								text-anchor="middle"
								dominant-baseline="central"
								font-size={r * 0.95}
								font-weight="700"
								fill={p.dead ? 'oklch(0.65 0.22 27)' : c}>{p.dead ? '☠' : initials(p.slug)}</text
							>
							<text
								y={r * 2.1 + p.stack * view.span * 0.025}
								text-anchor="middle"
								font-size={view.span * 0.022}
								fill={c}
								paint-order="stroke"
								stroke="black"
								stroke-width={view.span * 0.005}>{names[p.slug] ?? p.slug}</text
							>
						</g>
					{/if}
				{/each}
			</svg>

			{#if editing && draft && frozen}
				{@const f = frozen}
				<div class="space-y-2 border-t border-primary/40 bg-primary/5 px-4 py-3 text-xs">
					<p class="text-muted-foreground">
						Line the map up with the gold paths (where the party actually walked). Size first, then
						move, rotate only if the screenshot is tilted.
					</p>
					{#each [{ k: 'width', l: 'Size', min: f.span * 0.2, max: f.span * 4 }, { k: 'x', l: 'Left / right', min: f.x - f.w, max: f.x + f.w }, { k: 'y', l: 'Up / down', min: f.y - f.h, max: f.y + f.h }, { k: 'rotate', l: 'Rotate', min: -180, max: 180 }] as c (c.k)}
						<label class="flex items-center gap-3">
							<span class="w-24 shrink-0">{c.l}</span>
							<input
								type="range"
								min={c.min}
								max={c.max}
								step={c.k === 'rotate' ? 0.5 : f.span / 1000}
								bind:value={draft[c.k as keyof Align]}
								class="w-full accent-[var(--primary)]"
							/>
						</label>
					{/each}
					<div class="flex flex-wrap gap-2">
						<button
							class="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground"
							onclick={saveAlign}>Save alignment</button
						>
						<button
							class="rounded-md border border-border px-3 py-1.5"
							onclick={() => dm.data && (draft = fitAlign(dm.data.aspect))}>Fit to paths</button
						>
						<button
							class="rounded-md border border-border px-3 py-1.5"
							onclick={() => ((editing = false), (frozen = null))}>Cancel</button
						>
						<button
							class="ml-auto rounded-md border border-destructive/60 px-3 py-1.5 text-destructive"
							onclick={async () => {
								if (!confirm('Remove the map image of this dungeon?')) return;
								await client.mutation(api.dungeonMaps.remove, { instanceId });
								editing = false;
								frozen = null;
							}}>Remove map</button
						>
					</div>
				</div>
			{/if}

			<!-- trak -->
			<div class="space-y-2 border-t border-border/50 bg-background/60 px-4 py-3 backdrop-blur">
				<div class="relative h-2">
					{#each segments.filter((s) => s.kind === 'boss') as s (s.startMs)}
						<div
							class="absolute inset-y-0 rounded-sm {s.result === 'kill'
								? 'bg-primary/60'
								: 'bg-destructive/60'}"
							style="left: {(s.startMs / durationMs) * 100}%; width: {Math.max(
								0.4,
								((s.endMs - s.startMs) / durationMs) * 100
							)}%"
							title={s.name}
						></div>
					{/each}
					{#each deaths as d, i (i)}
						<div
							class="absolute -top-0.5 h-3 w-0.5 bg-destructive"
							style="left: {(d.atMs / durationMs) * 100}%"
							title="{names[d.slug] ?? d.slug} died"
						></div>
					{/each}
				</div>
				<input
					type="range"
					min="0"
					max={durationMs}
					step="500"
					bind:value={t}
					class="w-full accent-[var(--primary)]"
					aria-label="Replay time"
				/>
				<div class="flex flex-wrap items-center gap-2">
					<button
						class="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground"
						onclick={toggle}
					>
						{#if playing}<Pause class="size-4" /> Pause{:else}<Play class="size-4" /> Play{/if}
					</button>
					<button
						class="grid size-9 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
						aria-label="Back to the start"
						onclick={() => ((t = 0), (playing = false))}><RotateCcw class="size-4" /></button
					>
					<div class="flex gap-1 text-xs">
						{#each SPEEDS as s (s)}
							<button
								class="rounded border px-2 py-1 {speed === s
									? 'border-primary text-primary'
									: 'border-border text-muted-foreground'}"
								onclick={() => (speed = s)}>{s}×</button
							>
						{/each}
					</div>
					<span class="ml-auto font-display text-lg tabular-nums"
						>{clock(t)}
						<span class="text-sm text-muted-foreground">/ {clock(durationMs)}</span></span
					>
				</div>
			</div>
		</section>

		<!-- analitika v trenutku t -->
		<aside class="space-y-4">
			<section class="panel space-y-2">
				<div class="eyebrow">At {clock(t)} · damage per second</div>
				{#each stats as s (s.slug)}
					{@const c = classColor(classes[s.slug] ?? undefined)}
					<div class="text-sm {s.dead ? 'opacity-60' : ''}">
						<div class="flex items-baseline justify-between gap-2">
							<span class="truncate font-medium" style="color: {c}"
								>{s.dead ? '☠ ' : ''}{names[s.slug] ?? s.slug}</span
							>
							<span class="tabular-nums">{fmtNum(s.dps)}</span>
						</div>
						<div class="mt-0.5 h-1 overflow-hidden rounded-full bg-background/60">
							<div
								class="h-full rounded-full"
								style="width: {(s.dps / maxDps) * 100}%; background: {c}"
							></div>
						</div>
						<div class="mt-0.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
							<span>{fmtNum(s.damage)} dmg · {fmtNum(s.healing)} heal</span>
							<span>{s.hps ? `${fmtNum(s.hps)} HPS` : ''}{s.deaths ? ` · ${s.deaths}☠` : ''}</span>
						</div>
					</div>
				{/each}
			</section>
			<section class="panel space-y-1.5">
				<div class="eyebrow">What just happened</div>
				{#each events as e, i (i)}
					<button
						class="flex w-full items-baseline gap-2 text-left text-sm hover:text-primary"
						onclick={() => (t = e.at)}
					>
						<span class="w-10 shrink-0 text-xs text-muted-foreground tabular-nums"
							>{clock(e.at)}</span
						>
						<span
							class={e.kind === 'death' || e.kind === 'wipe'
								? 'text-destructive'
								: e.kind === 'kill'
									? 'text-primary'
									: ''}>{e.text}</span
						>
					</button>
				{:else}
					<p class="text-sm text-muted-foreground italic">Nothing yet. They're still buffing.</p>
				{/each}
			</section>
		</aside>
	</div>
{/if}
