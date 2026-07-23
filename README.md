# Problem-to-PDF Pipeline

Finds real problems people are searching for online (starting with the Stack Exchange network), ranks them by cross-platform demand, researches solutions with Claude, generates a PDF guide, and publishes it for sale on Gumroad. Runs entirely on Vercel + Supabase — no local machine required once deployed — and is controlled from a phone via a Telegram bot.

Full build spec, guardrails, schema, and build order: [`docs/spec.md`](docs/spec.md).

## Status

Build order (see spec for detail):

- [x] 1. Repo + Supabase schema + Voyage AI key
- [x] 2. Stack Exchange scraper → `raw_problems` + regulated-advice blocklist (confirmed working live)
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
- `lib/` — shared server-side helpers (Supabase client, env access, Stack Exchange client, blocklist) used by the cron/API functions.
- `api/` — Vercel serverless functions (cron jobs, bot webhook, etc.).

## Step 2: Stack Exchange scraper

`api/scrape-stackexchange.ts` is a Vercel Cron function (see `vercel.json`, runs daily at 06:00 UTC) that pulls the highest-voted questions from the last 6 months on the sites/tags in `lib/config.ts` (starts with `diy.stackexchange.com` and `cooking.stackexchange.com`), drops anything the blocklist flags as regulated-advice content (`lib/blocklist.ts`), and upserts the rest into `raw_problems` — re-running it is safe, duplicates are skipped via the unique constraint on `source_url` (`supabase/migrations/0002_raw_problems_source_url_unique.sql`, run this one too).

Reddit was the original plan here but got dropped — its Responsible Builder Policy prohibits commercializing data pulled via the API without express written approval, which this whole pipeline (paid PDFs, monetized blog) would trip. Stack Exchange content is CC BY-SA licensed with commercial reuse explicitly allowed, so it doesn't have that problem. See `docs/spec.md` for the full reasoning; Reddit can be revisited later only via its own commercial-approval process, as an addition, not a replacement.

**To wire it up:**
1. (Optional but recommended) Register an app at [stackapps.com/apps/oauth/register](https://stackapps.com/apps/oauth/register) to get a `key` — raises the shared quota from 300 requests/day to 10,000/day. No secret or OAuth flow needed for reading public questions.
2. Set `STACKEXCHANGE_KEY` in `.env` and in your Vercel project's environment variables (leave blank to use the low unauthenticated quota).
3. Optionally set `CRON_SECRET` (any random string) in both places — without it, the endpoint is publicly callable by anyone who finds the URL.
4. Deploy to Vercel, or run `npx vercel dev` locally, then hit `/api/scrape-stackexchange` (add `Authorization: Bearer <CRON_SECRET>` header if you set one). It returns a JSON summary of fetched/submitted/blocked counts per site — check `raw_problems` in the Supabase table editor to confirm rows landed.

**Confirmed working (2026-07-23):** deployed to Vercel, hit the endpoint directly — 24/25 `diy` questions and 25/25 `cooking` questions landed in `raw_problems` (1 caught by the regulated-advice blocklist). If you disabled "Automatically expose new tables" during Supabase project setup, you also need `supabase/migrations/0003_grant_service_role.sql` — that toggle skips granting table privileges to `service_role` too, not just `anon`/`authenticated`, and inserts fail with "permission denied" without it.

I couldn't test this against the live Stack Exchange/Supabase APIs myself — this sandbox's network is restricted to an allowlist that doesn't include either. Code typechecks clean; the above is the real test.
