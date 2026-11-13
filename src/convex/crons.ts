import { cronJobs } from 'convex/server';
import { internal } from './_generated/api.js';

const crons = cronJobs();

// En cron, ena akcija na minuto. Daljši interval se nastavi v settings (akcija preskoči minute).
crons.interval('poll players', { minutes: 1 }, internal.poll.run, {});

// Guild roster za predloge imen: 1 klic na dan.
crons.cron('guild roster', '0 5 * * *', internal.roster.refresh, {});

// Companion: stare zahteve za povezavo naprave (1 klic na dan).
crons.cron('companion link cleanup', '30 4 * * *', internal.companion.cleanupLinks, {});

export default crons;
