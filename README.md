# Problem-to-PDF Pipeline

Finds real problems people are searching for online (starting with Reddit), ranks them by cross-platform demand, researches solutions with Claude, generates a PDF guide, and publishes it for sale on Gumroad. Runs entirely on Vercel + Supabase — no local machine required once deployed — and is controlled from a phone via a Telegram bot.

Full build spec, guardrails, schema, and build order: [`docs/spec.md`](docs/spec.md).

## Status

Build order (see spec for detail):

- [x] 1. Repo + Supabase schema + Voyage AI key
- [x] 2. Reddit scraper → `raw_problems` + regulated-advice blocklist (code in — needs live test, see below)
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
- `lib/` — shared server-side helpers (Supabase client, env access, Reddit client, blocklist) used by the cron/API functions.
- `api/` — Vercel serverless functions (cron jobs, bot webhook, etc.).

## Step 2: Reddit scraper

`api/scrape-reddit.ts` is a Vercel Cron function (see `vercel.json`, runs daily at 06:00 UTC) that pulls the newest posts from the subreddits/keywords in `lib/config.ts` (starts with just `r/techsupport`), drops anything the blocklist flags as regulated-advice content (`lib/blocklist.ts`), and upserts the rest into `raw_problems` — re-running it is safe, duplicates are skipped via the unique constraint on `source_url` (`supabase/migrations/0002_raw_problems_source_url_unique.sql`, run this one too).

**To wire it up:**
1. Create a Reddit app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) → "create app" → type **script**. Note the client ID (the string under the app name) and the secret.
2. Set `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT` (format: `platform:app-id:version (by /u/your-username)`) in `.env` and in your Vercel project's environment variables.
3. Optionally set `CRON_SECRET` (any random string) in both places — without it, the endpoint is publicly callable by anyone who finds the URL.
4. Deploy to Vercel, or run `npx vercel dev` locally, then hit `/api/scrape-reddit` (add `Authorization: Bearer <CRON_SECRET>` header if you set one). It returns a JSON summary of fetched/submitted/blocked counts per subreddit — check `raw_problems` in the Supabase table editor to confirm rows landed.

I couldn't test this against the live Reddit/Supabase APIs myself — this sandbox's network is restricted to an allowlist that doesn't include either. Code typechecks clean; the above is the real test.
