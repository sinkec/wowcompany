// Razvojni posnetek UI brez Tauri (mockIPC). Ni del produkcijskega builda (vstop je samo index.html).
import { mockIPC } from '@tauri-apps/api/mocks';
import runs from './mock-run.json';
import type { RunRow, Status } from './lib/api';

const q = new URLSearchParams(location.search);
const run = (runs as unknown as Status['live'][])[0]!;
const now = Date.now();

const status: Status = {
	version: '0.1.0',
	apiBase: 'https://laudable-crane-432.eu-west-1.convex.site',
	settings: {
		logsDir: null,
		apiUrl: '',
		uploadsEnabled: true,
		minPlayers: 2,
		deviceName: 'battlestation (Linux)'
	},
	auth: {
		linked: q.get('linked') !== '0',
		pending: q.get('pending')
			? { code: 'MURLOC-4821', linkUrl: 'https://x/link', expiresAt: now + 6e5 }
			: null,
		error: null
	},
	watch: {
		logsDir:
			'/home/me/.steam/root/steamapps/compatdata/2726133678/pfx/drive_c/Program Files (x86)/World of Warcraft/_forever_/Logs',
		logsDirAuto: true,
		file: 'WoWCombatLog-111326_180000.txt',
		fileOffset: 123456,
		lines: 48211,
		badLines: 0,
		dungeon: q.get('tab') === 'live' ? 'Ragefire Chasm' : null,
		runInProgress: q.get('tab') === 'live',
		lastLineAt: now - 1500,
		discardedSolo: 1,
		error: null
	},
	upload: { lastError: null, lastUploadAt: now - 120000, blocked: false },
	queue: { pending: 1, uploaded: 2, failed: 1 },
	runsVersion: 1,
	live: q.get('tab') === 'live' ? { ...run, endReason: 'inProgress' } : null
};

const rows: RunRow[] = [
	{
		runKey: 'a',
		zone: 'Ragefire Chasm',
		startedAt: now - 2 * 3600e3,
		durationMs: 31 * 60e3 + 12e3,
		bossesKilled: 4,
		bossesTotal: 4,
		deaths: 3,
		players: ['Tankus Maximus', 'Fizzle Boom', 'Mendy Bandage'],
		status: 'uploaded',
		attempts: 1,
		lastError: null,
		url: 'https://wowcompany.vercel.app/runs/abc',
		uploadedAt: now - 7000e3
	},
	{
		runKey: 'b',
		zone: 'Deadmines',
		startedAt: now - 30 * 60e3,
		durationMs: 42 * 60e3,
		bossesKilled: 6,
		bossesTotal: 8,
		deaths: 9,
		players: ['Tankus Maximus', 'Fizzle Boom'],
		status: 'pending',
		attempts: 2,
		lastError: 'network: connection refused',
		url: null,
		uploadedAt: null
	},
	{
		runKey: 'c',
		zone: 'Wailing Caverns',
		startedAt: now - 26 * 3600e3,
		durationMs: 55 * 60e3,
		bossesKilled: 8,
		bossesTotal: 8,
		deaths: 1,
		players: ['Tankus Maximus', 'Mendy Bandage', 'Fizzle Boom'],
		status: 'failed',
		attempts: 1,
		lastError: '400: startedAt out of range',
		url: null,
		uploadedAt: null
	}
];

mockIPC((cmd) => {
	switch (cmd) {
		case 'get_status':
			return status;
		case 'list_runs':
			return rows;
		case 'locate_logs':
			return [
				{
					path: status.watch.logsDir,
					flavor: '_forever_',
					newestLog: status.watch.file,
					newestAgeSecs: 12
				}
			];
		default:
			return null;
	}
});

await import('./main');
const tab = q.get('tab');
if (tab && tab !== 'live') {
	setTimeout(() => {
		const label = tab === 'runs' ? 'Runs' : 'Settings';
		[...document.querySelectorAll('nav button')]
			.find((b) => b.textContent?.startsWith(label))
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	}, 300);
}
