// Tipi in klici Tauri ukazov (desktop/src-tauri/src/commands.rs). Imena polj = Rust serde camelCase.
import { invoke } from '@tauri-apps/api/core';

export type Settings = {
	logsDir: string | null;
	apiUrl: string;
	uploadsEnabled: boolean;
	minPlayers: number;
	deviceName: string;
};

export type PendingLink = { code: string; linkUrl: string; expiresAt: number };

export type SpellStat = {
	id: number;
	name: string;
	amount: number;
	hits: number;
	crits: number;
	pet: boolean;
};

export type PlayerSummary = {
	guid: string;
	name: string;
	slug: string;
	recorder: boolean;
	level: number | null;
	damage: number;
	healing: number;
	overheal: number;
	shielding: number;
	damageTaken: number;
	environmentalTaken: number;
	deaths: number;
	interrupts: number;
	dispels: number;
	activeMs: number;
	dps: number;
	hps: number;
	critPct: number;
	topDamage: SpellStat[];
	topHealing: SpellStat[];
};

export type RunSummary = {
	runKey: string;
	zone: { instanceId: number; name: string; difficultyId: number; instanceUid: number | null };
	startedAt: number;
	endedAt: number;
	durationMs: number;
	endReason: string;
	result: { bossesKilled: number; bossesTotal: number | null; wipes: number; cleared: boolean };
	recorder: string | null;
	players: PlayerSummary[];
	segments: {
		kind: 'boss' | 'trash';
		name: string;
		encounterId: number | null;
		startMs: number;
		endMs: number;
		result: 'kill' | 'wipe' | 'none';
	}[];
	deaths: { slug: string; atMs: number; killer: string | null; killingBlow: string | null }[];
};

export type Status = {
	version: string;
	apiBase: string;
	settings: Settings;
	auth: { linked: boolean; pending: PendingLink | null; error: string | null };
	watch: {
		logsDir: string | null;
		logsDirAuto: boolean;
		file: string | null;
		fileOffset: number;
		lines: number;
		badLines: number;
		dungeon: string | null;
		runInProgress: boolean;
		lastLineAt: number | null;
		discardedSolo: number;
		error: string | null;
	};
	upload: { lastError: string | null; lastUploadAt: number | null; blocked: boolean };
	queue: { pending: number; uploaded: number; failed: number };
	runsVersion: number;
	live: RunSummary | null;
};

export type RunRow = {
	runKey: string;
	zone: string;
	startedAt: number;
	durationMs: number;
	bossesKilled: number;
	bossesTotal: number | null;
	deaths: number;
	players: string[];
	status: 'pending' | 'uploaded' | 'failed';
	attempts: number;
	lastError: string | null;
	url: string | null;
	uploadedAt: number | null;
};

export type Candidate = {
	path: string;
	flavor: string;
	newestLog: string | null;
	newestAgeSecs: number | null;
};

export const api = {
	status: () => invoke<Status>('get_status'),
	startLink: () => invoke<PendingLink>('start_link'),
	cancelLink: () => invoke<void>('cancel_link'),
	unlink: () => invoke<void>('unlink'),
	locateLogs: () => invoke<Candidate[]>('locate_logs'),
	saveSettings: (settings: Settings) => invoke<void>('save_settings', { settings }),
	listRuns: (limit = 100) => invoke<RunRow[]>('list_runs', { limit }),
	retryRun: (runKey: string) => invoke<void>('retry_run', { runKey }),
	deleteRun: (runKey: string) => invoke<void>('delete_run', { runKey }),
	endRun: () => invoke<void>('end_run'),
	openUrl: (url: string) => invoke<void>('open_url', { url })
};

export const fmtNum = (n: number) => Math.round(n).toLocaleString('en-US');

export function fmtDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function ago(ms: number | null): string {
	if (!ms) return 'never';
	const s = Math.round((Date.now() - ms) / 1000);
	if (s < 10) return 'just now';
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return `${Math.floor(s / 86400)} d ago`;
}

export const errText = (e: unknown) =>
	typeof e === 'string' ? e : e instanceof Error ? e.message : JSON.stringify(e);
