# Problem-to-PDF Pipeline

Finds real problems people are searching for online (starting with the Stack Exchange network), ranks them by cross-platform demand, researches solutions with Claude, generates a PDF guide, and publishes it for sale on Gumroad. Runs entirely on Vercel + Supabase — no local machine required once deployed — and is controlled from a phone via a Telegram bot.

Full build spec, guardrails, schema, and build order: [`docs/spec.md`](docs/spec.md).

## Status

Build order (see spec for detail):

- [x] 1. Repo + Supabase schema + Voyage AI key
- [x] 2. Stack Exchange scraper → `raw_problems` + regulated-advice blocklist (confirmed working live)
- [x] 3. Clustering + ranking cron (Voyage AI embeddings) (confirmed working live)
- [x] 4. Telegram bot: list clusters, approve action (confirmed working live)
- [x] 5. Research step (Gemini + Tavily search grounding) (confirmed working live)
- [x] 6. PDF generation + pricing tiers + disclaimer (confirmed working live, first try)
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

## Step 4: Telegram bot (approve action)

No separate cron for this — notification is the last step of `api/cluster-problems.ts` (`lib/notifyClusters.ts`), not a third scheduled function, since Vercel's Hobby plan caps cron jobs at 2 and we're already at that limit with the scraper and clustering job. It runs regardless of whether that invocation clustered anything new, so it also catches up on any backlog of un-notified clusters.

Each run sends the top `CLUSTERS_TO_NOTIFY_PER_RUN` (`lib/config.ts`, starts at 5) not-yet-notified clusters to your Telegram chat, highest score first, each with an example source link and an inline **"✅ Approve"** button. Tapping it hits `api/telegram-webhook.ts`, which sets that cluster's `status` to `approved` and edits the message to confirm. `problem_clusters.telegram_notified_at` (`supabase/migrations/0005_problem_clusters_telegram_notified.sql`, run this one too) tracks what's already been sent so nothing repeats.

**To wire it up:**
1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, follow the prompts. You get a bot token — that's `TELEGRAM_BOT_TOKEN`.
2. Send your new bot any message (e.g. "hi") so Telegram has a chat to report.
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in your phone browser (replace `<TOKEN>`) — find `"chat":{"id": ...}` in the response. That number is `TELEGRAM_CHAT_ID`.
4. Generate a random string for `TELEGRAM_WEBHOOK_SECRET` (any value works — this just has to match between Vercel and the webhook registration in step 6).
5. Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_WEBHOOK_SECRET` to Vercel's environment variables, then redeploy.
6. Register the webhook by visiting (in your phone browser, once):
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://problem-pdf-pipeline.vercel.app/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
   A `{"ok":true,"result":true,...}` response means it registered.
7. Trigger `/api/cluster-problems?secret=<CRON_SECRET>` — since all 49 existing clusters are already clustered but none have been notified yet, this should send up to 5 of them straight to your Telegram chat.
8. Tap **Approve** on one — the message should update to show "✅ Approved", and that cluster's `status` should flip to `approved` in Supabase.

Same caveat as the previous steps — couldn't test any of this against live Telegram/Supabase from this sandbox. Code typechecks clean; the real test is your run.

**Confirmed working (2026-07-23):** hit a `column problem_clusters.telegram_notified_at does not exist` error on the first attempt — migration `0005` hadn't been applied yet. After running it, `/api/cluster-problems` sent 5 clusters to Telegram with correct titles/scores/source links and working Approve buttons; tapping Approve updated the message to "✅ Approved" and flipped `status` to `approved` in Supabase. Full loop confirmed end to end.

## Step 5: Research (Gemini + Tavily search, manually combined)

Folded into `api/cluster-problems.ts` (`lib/researchClusters.ts`) rather than a third cron, same Hobby-plan reasoning as notifications — runs at the end of every invocation, picks up the top `RESEARCH_PER_RUN` (`lib/config.ts`, starts at 3) clusters with `status = 'approved'`, and for each one researches the problem. The result (Markdown: Problem / Root Causes / Step-by-Step Fix / Resources) is saved to `research_docs`, and the cluster's `status` advances to `researched`.

**Provider note:** the original plan was Claude with its server-side web search tool. Anthropic's console requires a paid credit purchase before a key works at all; Gemini's free tier via Google AI Studio doesn't. The original Claude implementation is recoverable from git history (`lib/claude.ts`, in the commit that added step 5) if the Anthropic key gets funded later.

**Model name and quota, the hard way:** `gemini-2.5-flash` 404'd ("no longer available to new users"). Both `-latest` aliases tried (`gemini-flash-latest`, `gemini-flash-lite-latest`) resolved to models with a restrictive free-tier quota (RPM 5 / RPD 20) and 429'd. Settled on pinning directly to `gemini-3.5-flash-lite`, confirmed via the account's live rate-limit dashboard to have a much higher grant (RPM 15 / RPD 500) — the newer-generation Flash-Lite models get that higher quota, older ones and regular Flash don't.

**Gemini's own search grounding is billing-gated** — confirmed by testing: the identical request 429'd with grounding on and succeeded immediately with it off, even on a model with plenty of quota headroom. Rather than accept ungrounded (training-knowledge-only) output permanently, `lib/tavily.ts` searches the web independently via Tavily's free tier (1,000 searches/month, confirmed no card required) and `lib/gemini.ts` hands those real results to Gemini as context, instructing it to cite only the provided URLs rather than inventing sources. This is real search grounding, just assembled manually instead of using Gemini's native (paywalled) tool — and it's provider-agnostic, so it'd work the same way if this ever moves back to Claude.

**To wire up Tavily:**
1. Sign up at [tavily.com](https://tavily.com) — free tier, no credit card.
2. Grab the API key from the dashboard.
3. Set `TAVILY_API_KEY` in Vercel's environment variables, then redeploy.
4. Trigger `/api/cluster-problems?secret=<CRON_SECRET>` again (needs another approved-but-unresearched cluster — the one from the first test is already `researched`; approve a new one in Telegram first if needed).
5. Check the new `research_docs` row — the `Resources` section should now cite the actual URLs Tavily returned, not just plausible-sounding ones from training knowledge.

**Confirmed working (2026-07-23):** first run (before the Tavily upgrade) produced a genuinely good guide from training knowledge alone. Second run with Tavily wired in confirmed real grounding is working — the `Resources` section cited actual, verifiable URLs (Serious Eats, The Kitchn, a real Emmymade review, a real Stack Exchange thread), not just plausible-sounding ones. Content itself stayed well-structured and specific. Step 5 is genuinely done — real search-grounded research, not a compromise.

## Step 6: PDF generation

Also folded into `api/cluster-problems.ts` (`lib/generatePdfs.ts`) — same cron-limit reasoning as steps 4/5. Runs at the end of every invocation, picks up the top `PDF_PER_RUN` (`lib/config.ts`, starts at 3) clusters with `status = 'researched'`, and for each one:

1. Converts the `research_docs` Markdown to styled HTML (`lib/pdfTemplate.ts`, via the `marked` library) — title from `representative_text`, and the guardrails disclaimer boilerplate injected right under the title on every single PDF regardless of topic.
2. Renders it to an actual PDF using headless Chromium (`lib/pdf.ts`, `puppeteer-core` + `@sparticuz/chromium` — full `puppeteer` bundles an incompatible Chromium build for serverless, hence the split package).
3. Uploads the PDF to Supabase Storage (`lib/storage.ts`, bucket `pdfs`, created automatically on first use — no manual dashboard step) and gets a public URL.
4. Computes a price tier from the research content's word count and resource-link count (`lib/pricing.ts` — $5/$9/$14, an unvalidated starting guess per the spec's pricing strategy, easy to retune once there's real sales data).
5. Saves the row to `pdfs` (`file_url`, `title`, `price`) and advances the cluster's `status` to `drafted`.

`vercel.json` bumps this function to 1024 MB memory and a 300s max duration — headless Chromium needs real memory headroom, and this is now the heaviest single step in the pipeline.

**This is the highest-risk step so far, genuinely untested even by proxy** — Puppeteer-on-serverless is a notoriously fragile combination (bundle size limits, cold-start behavior, memory pressure), and this sandbox has no headless Chrome environment to test against at all, unlike the API calls elsewhere in this pipeline where I could at least confirm the request shape was right before deploying. Expect this one to likely need more than one live debugging round.

**Pre-deploy fixes applied after live research** (verified against `@sparticuz/chromium`'s own README in `node_modules`, plus the installed package's `package.json`):
- `headless: "shell"` instead of `headless: true` — this package's binary is specifically `headless_shell`, which doesn't support Chrome's "new" headless mode that `true` would otherwise select. Would very likely have failed to launch at all.
- `args` now goes through `puppeteer.defaultArgs({ args: chromium.args, headless: "shell" })` instead of passing `chromium.args` directly — matches the package's own documented usage, merges in Puppeteer's required defaults alongside the serverless-tuned flags.
- Added `"engines": {"node": "22.x"}` to `package.json` — `@sparticuz/chromium@149` requires Node `^22.17.0 || >=24.0.0`; a plain Vercel Functions project with no `engines` field could land on an older default runtime that doesn't satisfy this.
- Added `includeFiles` in `vercel.json` for the Chromium binary directory — defensive measure in case Vercel's automatic file tracing misses the dynamically-resolved binary path (a documented failure mode for this package: `"The input directory /var/task/bin does not exist"`).

**One thing I can't fix in code, only flag honestly:** the package's own README recommends "at least 512 MB, but 1600 MB (or more)" of memory. Vercel's Hobby plan caps functions at 1024 MB total — so the `memory: 1024` already set in `vercel.json` is the ceiling on Hobby, not a safe buffer under the package's own recommendation. If PDF generation fails specifically on memory/OOM, the only real fix is upgrading to Vercel Pro (higher memory ceiling, ~3008 MB) — worth knowing before we spend a debugging round chasing something that's actually a plan limit, not a bug.

**To wire it up:**
1. No new API key needed — this step only touches Supabase (already configured) and computes everything else.
2. Push/redeploy so Vercel picks up the new `vercel.json` memory/duration settings.
3. Make sure at least one cluster has `status = 'researched'` (should already be true from step 5's testing).
4. Trigger `/api/cluster-problems?secret=<CRON_SECRET>` — response now includes a `drafted` count.
5. Check the `pdfs` table in Supabase for a new row, and check Storage → the `pdfs` bucket for the actual file. Open the `file_url` and confirm it's a real, readable PDF with the title, disclaimer, and formatted guide content.
6. If it errors, send me the Vercel logs — given the caveat above, budget for this taking a few rounds.

**Confirmed working (2026-07-23), first try:** drafted 3 PDFs in a single run. All four checks passed — real row in `pdfs`, real file in Storage, `file_url` opened as a genuinely readable PDF (title, disclaimer box, all four sections, working resource links), cluster `status` advanced to `drafted`. No debugging round needed — a direct result of catching the `headless: "shell"` and `defaultArgs` issues via research before deploying instead of after a crash.
