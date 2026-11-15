import { cronJobs } from 'convex/server';
import { internal } from './_generated/api.js';

const crons = cronJobs();

// Poller se načrtuje sam (poll.begin -> scheduler, interval iz settings); ta cron samo preveri,
// ali veriga teče, in jo po potrebi zažene (npr. po prvem deployu). Pavza = 0 zagonov pollerja.
crons.interval('poll watchdog', { minutes: 15 }, internal.poll.watchdog, {});

// Guild roster za predloge imen: 1 klic na dan.
crons.cron('guild roster', '0 5 * * *', internal.roster.refresh, {});

// Companion: stare zahteve za povezavo naprave (1 klic na dan).
crons.cron('companion link cleanup', '30 4 * * *', internal.companion.cleanupLinks, {});

export default crons;
