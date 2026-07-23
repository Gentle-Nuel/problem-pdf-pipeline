# Problem-to-PDF Pipeline

Finds real problems people are searching for online (starting with Reddit), ranks them by cross-platform demand, researches solutions with Claude, generates a PDF guide, and publishes it for sale on Gumroad. Runs entirely on Vercel + Supabase — no local machine required once deployed — and is controlled from a phone via a Telegram bot.

Full build spec, guardrails, schema, and build order: [`docs/spec.md`](docs/spec.md).

## Status

Build order (see spec for detail):

- [x] 1. Repo + Supabase schema + Voyage AI key
- [ ] 2. Reddit scraper → `raw_problems` + regulated-advice blocklist
- [ ] 3. Clustering + ranking cron (Voyage AI embeddings)
- [ ] 4. Telegram bot: list clusters, approve action
- [ ] 5. Research step (Claude + web search)
- [ ] 6. PDF generation + pricing tiers + disclaimer
- [ ] 7. Pre-publish review tap
- [ ] 8a. Companion blog draft + humanize pipeline
- [ ] 8b. Static site deploy
- [ ] 9. Gumroad publish

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in keys as each build step needs them (Supabase and Voyage AI are needed now; the rest come online in later steps).
3. Apply the schema to your Supabase project: open the SQL editor in your Supabase dashboard and run `supabase/migrations/0001_init.sql`. (If you prefer the Supabase CLI and have a project linked, `supabase db push` works too.)

## Project layout

- `docs/spec.md` — the full build spec: pipeline stages, schema, guardrails, pricing strategy, build order.
- `supabase/migrations/` — SQL schema, applied in order.
- `lib/` — shared server-side helpers (Supabase client, env access) used by the cron/API functions added in later steps.
- `api/` — Vercel serverless functions (cron jobs, bot webhook, etc.) — added starting with step 2.
