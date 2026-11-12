# WowCompany

Tracks a group of friends' **WoW Forever** heroes (EU): levels, gear, stats and spectacular deaths.
Web: SvelteKit 3 + Tailwind + shadcn-svelte on Vercel · Backend: Convex (DB, cron, actions) ·
Auth: Better Auth + Google · Discord: webhook posts + HTTP slash commands · Data: Battle.net API.

See [PLAN.md](PLAN.md) for architecture, free-tier budget and phases.

## Local development

```bash
bun install
bunx convex dev          # terminal 1 – Convex functions (keeps running)
bun run dev              # terminal 2 – http://localhost:5173
```

Secrets live in `.env` (never committed). Push them to Convex:

```bash
bun run env:push           # dev deployment
bun run env:push -- --prod # production (uses *_PROD overrides, e.g. SITE_URL_PROD)
```

## Checks

```bash
bun run check              # svelte-check + types
bun run test               # unit tests (Discord visibility)
bun run check:visibility   # public/private filtering against the dev deployment
```

## Deploy

Vercel builds with `vercel.json` (`convex deploy` + `bun run build`). Vercel needs only
`CONVEX_DEPLOY_KEY` (Production deploy key from the Convex dashboard).

The first user to sign in on a fresh deployment becomes the admin ("Guild Master").

---

Non-commercial fan project. Not affiliated with Blizzard Entertainment.
