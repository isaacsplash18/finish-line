# Finish Line

A single-user app whose entire purpose is to make Isaac finish what he starts.

- Track every project through Idea → Building → Shipped → Commercialising → Done,
  with a soft WIP cap that prices distraction instead of blocking it.
- A reward economy where finishing buys something real, and stalling, over-committing
  or abandoning costs something the app can actually enforce.
- Daily and weekly routines rolled up into two hero numbers: **Flow** and **Focus**.

Dark UI. Big numbers. Red means Stuck or Forfeited, and nothing else.

## Run it

```bash
npm install
cp .env.example .env.local     # Supabase URL + anon key
npm run dev
```

Then run `supabase/migrations/0001_init.sql` in the Supabase SQL editor. It is
idempotent and seeds enough data to be useful on day one.

## Scripts

| Command | What |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (type-checks) |
| `npm test` | Score maths unit tests |
| `npm run lint` | ESLint |

## Docs

- **`ARCHITECTURE.md`** — the contract: file map, data-access signatures,
  component props, styling rules, PRD deviations. Read this first.
- **`SPEC-CHANGES.md`** — authoritative amendments to the PRD.
- **`PRD-focus-app.md`** — the original spec.

Nightly recompute runs at `GET /api/cron` (Vercel Cron, 16:00 UTC = midnight SGT),
and lazily on dashboard load if the cron missed a night.
