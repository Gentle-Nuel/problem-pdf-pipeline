# Problem-to-PDF Pipeline

Finds real problems people are searching for online (starting with the Stack Exchange network), ranks them by cross-platform demand, researches solutions with Claude, generates a PDF guide, and publishes it for sale on Gumroad. Runs entirely on Vercel + Supabase — no local machine required once deployed — and is controlled from a phone via a Telegram bot.

Full build spec, guardrails, schema, and build order: [`docs/spec.md`](docs/spec.md).

## Status

Build order (see spec for detail):

- [x] 1. Repo + Supabase schema + Voyage AI key
- [x] 2. Stack Exchange scraper → `raw_problems` + regulated-advice blocklist (confirmed working live)
- [x] 3. Clustering + ranking cron (Voyage AI embeddings) (confirmed working live)
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

## Step 3: Clustering + ranking

`api/cluster-problems.ts` is a Vercel Cron function (runs daily at 07:00 UTC, an hour after the scrape) that finds `raw_problems` not yet linked to a cluster, embeds them in one batch call via Voyage AI (`lib/voyage.ts`), and compares each against existing cluster embeddings using cosine similarity (`lib/similarity.ts`). A match above `CLUSTER_SIMILARITY_THRESHOLD` (`lib/config.ts`, starts at 0.84 — unvalidated, see the comment there) joins that cluster; otherwise it starts a new one, using the problem's title as `representative_text`. Every touched cluster gets `source_count`/`total_engagement`/`score` recomputed from its full membership (`lib/scoring.ts`) so aggregates can't drift.

Cluster embeddings are stored as a plain `jsonb` array on `problem_clusters` (`supabase/migrations/0004_problem_clusters_embedding.sql`, run this one too) — comparisons happen in JS, no `pgvector` extension needed at this scale.

**To wire it up:**
1. Get a Voyage AI API key at [voyageai.com](https://voyageai.com) (dashboard → API keys).
2. Set `VOYAGE_API_KEY` in `.env` and in Vercel's environment variables, then redeploy.
3. Hit `/api/cluster-problems` (same `CRON_SECRET` header rule as the scraper). It returns counts of problems processed, new clusters created, and clusters touched.
4. Check `problem_clusters` and `cluster_members` in Supabase to see the actual groupings — this is the point where the 0.84 threshold needs a human sanity check: skim a few clusters, see if anything obviously duplicate got left separate, or anything unrelated got merged, and report back so the threshold can be tuned.

Same caveat as step 2 — couldn't test this against live Voyage/Supabase from this sandbox. Code typechecks clean; the real test is your run.

**Confirmed working (2026-07-23):** first live run produced 49 singleton clusters from 49 raw_problems (zero merges). `api/cluster-diagnostics.ts` (manual-only, not on a cron schedule — reports the closest pairs and a similarity histogram from existing cluster embeddings, no new Voyage calls) confirmed this was correct rather than the threshold being too strict: the closest pair in the whole batch was 0.615 similarity, nowhere near 0.84, and topically-related-but-different (not real duplicates). Stack Exchange moderators already merge duplicate questions before they accumulate votes, so a clean top-voted sample being mostly distinct is expected — 0.84 hasn't caused a false negative yet, but also hasn't been tested against a real duplicate. Revisit once more scrape runs accumulate and genuine repeat problems show up.

This run also surfaced a real bug, since fixed: Stack Exchange HTML-escapes question titles, not just bodies (`&quot;`, `&#39;`, etc.), and only body text was being decoded. Since the title becomes `representative_text` — which the spec has becoming the actual PDF title / Gumroad listing copy — this would have shipped literal HTML entities into paid product titles. Fixed in `lib/stackexchange.ts`; the 49 rows from this test run still have the raw entities since they predate the fix, which is fine since this is pipeline-validation data, not anything customer-facing yet.
