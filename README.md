# Problem-to-PDF Pipeline

Finds real problems people are searching for online (starting with the Stack Exchange network), ranks them by cross-platform demand, researches solutions with Claude, generates a PDF guide, and publishes it for sale on Gumroad. Runs entirely on Vercel + Supabase — no local machine required once deployed — and is controlled from a phone via a Telegram bot.

Full build spec, guardrails, schema, and build order: [`docs/spec.md`](docs/spec.md).

## Status

Build order (see spec for detail):

- [x] 1. Repo + Supabase schema + Voyage AI key
- [x] 2. Stack Exchange scraper → `raw_problems` + regulated-advice blocklist (confirmed working live)
- [x] 2b. Google autocomplete cross-validation (added after steps 2–6 — was in the spec's Data sources but never got a build-order step; `source_count` had been stuck at 1 for every cluster until this) (confirmed working live — see below)
- [x] 3. Clustering + ranking cron (Voyage AI embeddings) (confirmed working live)
- [x] 4. Telegram bot: list clusters, approve action (confirmed working live)
- [x] 5. Research step (Gemini + Tavily search grounding) (confirmed working live)
- [x] 6. PDF generation + pricing tiers + disclaimer (confirmed working live, first try)
- [x] 7. Pre-publish review tap (confirmed working live)
- [x] 8a. Companion blog draft + humanize pipeline (confirmed working live, first try)
- [x] 8b. Static site deploy (confirmed working live)
- [x] 9. Gumroad publish handoff (manual, not API — Gumroad's API can't create a product with a file at all, verified live; see below) (confirmed working live, first try)

**Build order complete.** Every step from the original spec, plus the 2b gap-fill, is built and confirmed working against real data — scrape through cross-platform ranking, Telegram approval, AI research, PDF generation, pre-publish review, a live companion blog site with real SEO plumbing, and the Gumroad handoff. The pipeline can run a real problem from "someone asked this on Stack Exchange" to "a priced guide sitting in front of you ready to sell" without needing a PC at any point.

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

**Expanded scrape targets (2026-07-24), once the full build order was proven end to end:** added `gaming` and `outdoors` to `SCRAPE_TARGETS` (`lib/config.ts`) — same "safe practical problem, no regulated-advice surface" shape as diy/cooking. A third addition, `home-automation`, was tried alongside them and dropped — Stack Exchange's API returned a real live "No site found for name `home-automation`", meaning either it isn't an independent Stack Exchange site or its actual API site identifier is something else; see the comment in `lib/config.ts` before retrying that one. This also surfaced a real resilience gap: the scrape endpoint had no per-target error handling, so that one bad site name crashed the *entire* response with a 500 — even though `diy`/`cooking`/`gaming`/`outdoors` had already committed successfully by that point (confirmed in Supabase). Fixed with the same per-target try/catch pattern already used in `lib/scrapeGooglePaa.ts`; the response now includes a `failed[]` array instead of a blanket crash. Confirmed clean afterward: `diy: 24/25`, `cooking: 25/25`, `gaming: 25/25`, `outdoors: 16/17`, `failed: []`.

I couldn't test this against the live Stack Exchange/Supabase APIs myself — this sandbox's network is restricted to an allowlist that doesn't include either. Code typechecks clean; the above is the real test.

## Step 2b: Google autocomplete cross-validation

Added after steps 2–6 were already built and confirmed working — a real gap, not a planned later addition. The original spec listed Google autocomplete/"People also ask" as a secondary validation source, but it never got its own line in the numbered build order, so it just didn't get built. The practical cost: `problem_clusters.score = sourceCount * 100 + totalEngagement` was designed to weight cross-source validation heavily, but with only one source ever feeding the pipeline, `source_count` had been `1` for every single cluster — that `× 100` term was a constant, not a differentiator.

`lib/scrapeGooglePaa.ts` (called from the end of `api/scrape-stackexchange.ts` — same cron slot, no new cron needed) picks up to `GOOGLE_PAA_CLUSTERS_PER_RUN` (`lib/config.ts`, starts at 5) clusters that haven't been checked yet (`problem_clusters.paa_checked_at is null`), queries Google's autocomplete endpoint with each cluster's `representative_text`, and filters suggestions through the same regulated-advice blocklist.

**This went through several live-debugging rounds before landing on the current design:**
1. **`client=firefox` → 400.** Google's autocomplete endpoint rejects that client param; `client=chrome` works. (`lib/googlePaa.ts`)
2. **6-word query truncation gutted the query's specificity.** The original code sent only the first 6 words of `representative_text` — fine for a title like a short question, broken for one like *"Is it OK to relabel a main panel breaker?"*, where the first 6 words are *"Is it ok to relabel a"* and the actual topic word (*"breaker"*) gets cut. Confirmed live: this produced completely unrelated suggestions (dog names, antibiotics) for a DIY electrical question. Fixed by sending the full (already-short) `representative_text` — `representative_text` is just a Stack Exchange title, so no truncation is needed at all.
3. **One query 400'd; turned out to be a one-off, not a pattern.** Initially suspected an undocumented query-length limit (a 112-char query 400'd where a 41-char one succeeded) and added a length cap — but live testing (pushing a real query out to 2,000 raw characters against the actual endpoint) found no length-based 400 exists at any length tested; long/unusual queries just return an empty suggestion array with a normal 200. The cap was reverted. The real fix that stuck: **per-cluster failures are now caught, logged with the exact failing query, and don't abort the run or leave that cluster stuck retrying forever** (it still gets marked `paa_checked_at` so a bad cluster can't jam every future run) — that's what actually matters for an occasional transient failure, regardless of cause.
4. **Suggestions were topically correct but never merged into their source cluster.** Once the query bug was fixed, e.g. a "metal roofing" DIY cluster produced clearly-on-topic suggestions ("can you grill under a metal roof," "can metal roofing be used as siding"). But the plan to let the existing embedding-similarity clustering cron merge them in "if similar enough" doesn't work in practice: a live pairwise-similarity check (`api/cluster-diagnostics.ts`) showed the source cluster's best match to *anything*, including its own generated suggestions, was below 0.71 — nowhere near the `CLUSTER_SIMILARITY_THRESHOLD` of 0.84. A formal Stack Exchange title and a short colloquial autocomplete phrasing sit far apart in embedding space even on the exact same topic; cosine similarity can't cleanly tell "same problem, different phrasing" apart from "same topic, different problem." **Fixed by replacing the merge decision with an LLM judgment call** (`lib/paaJudge.ts`): each cluster's suggestions go to Gemini in one batched call asking it to label each one `same` / `related` / `different` against the source cluster's text. Only `same` verdicts get attached directly to that cluster (`lib/clusterAggregates.ts` recomputes `source_count`/`score` right there, same logic `api/cluster-problems.ts` uses); everything else still lands as a normal unclustered `raw_problems` row and flows through the existing embedding-similarity clustering exactly as before, so it can still become its own new cluster. A failed judgment call degrades to that same unclustered behavior rather than losing the suggestions.

Deliberately scoped so none of this touches `CLUSTER_SIMILARITY_THRESHOLD` or the Stack-Exchange-to-Stack-Exchange dedup logic — the LLM judgment path is the only thing that can attach a `google_paa` row directly to a cluster, and it only fires on an explicit "same" verdict.

**To wire it up:**
1. Run `supabase/migrations/0006_problem_clusters_paa_checked.sql` in the Supabase SQL editor (if not already run).
2. No new API key needed for the autocomplete endpoint itself; the judgment step reuses the existing `GEMINI_API_KEY` from step 5.
3. Push/redeploy, then trigger `/api/scrape-stackexchange?secret=<CRON_SECRET>` — response now includes `googlePaa: { checked, submitted, directlyAttached, failed }`.
4. Check `raw_problems` for new rows with `source = google_paa`.
5. Check `problem_clusters.source_count` for any cluster the run touched — a `directlyAttached` count above 0 should correspond to a real `source_count > 1` on that specific cluster, not just any cluster in the table.

**Confirmed working live, end to end:** `checked: 5, submitted: 7, directlyAttached: 5, failed: []`. Checked `problem_clusters` sorted by `source_count` — two clusters now show `source_count: 2` (score 210 and 209), both from a real `source = 'google_paa'` member attached alongside their original `source = 'stackexchange'` member, correctly outranking every remaining single-source cluster (which top out at 119). This is the first time `source_count` has moved off `1` for any cluster since the pipeline went live, and it's for the right reason — an LLM-confirmed match, not a coincidental embedding score.

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

**Two real fixes after the site expanded to gaming/outdoors/photo (2026-07-24), both caught from reading an actual generated PDF, not from an error:**
- **Fixed section headers didn't fit every question.** The research prompt originally forced every guide into "Problem / Root Causes / Step-by-Step Fix / Resources" — fine for troubleshooting questions from diy/cooking, but a real PDF for a factual gaming question ("What's the first videogame with a female antagonist?") got forced through "Root Causes" and "Fix" framing that didn't make sense for a question with no root cause or fix. `lib/gemini.ts`'s prompt now lets the model choose headers that fit the actual question shape (troubleshooting vs. factual/informational vs. other), always still ending in a `## Resources` section. `lib/pricing.ts`'s tiering already worked off word count and link count, not specific headers, so it needed no changes.
- **PDFs were never humanized — only the blog post was.** That was the original spec's design (structured reference guide vs. a warmer free teaser), but reading a real PDF showed it noticeably more AI-generated than the blog post drawn from the same research. Generalized `lib/blogHumanize.ts` into `lib/humanize.ts` (same pass, generic wording instead of "blog post"-specific) and wired it into PDF generation too, right before rendering. Not persisted as a separate column — the rendered PDF file is the artifact that matters downstream, nothing else needs the intermediate humanized markdown text.

**Confirmed working live (2026-07-24):** re-triggered research for a factual gaming question ("What's the first game with an all-female cast?") after both fixes shipped. Real result — headers came back as "Short Answer" and "Details Worth Knowing" instead of forced Root-Causes/Fix framing, and the humanize pass added genuine editorial personality ("Frankly, digging through 1980s software libraries often reveals murky documentation and half-baked ports, but this particular release fits the bill.") without any fabricated experience or credentials — the exact guardrail-compliant shape this was designed for. Five distinct real citations, correctly numbered and linked.

## Step 7: Pre-publish review tap

Also folded into `api/cluster-problems.ts` (`lib/reviewPdfs.ts`), same cron-limit reasoning as steps 4–6. Runs at the end of every invocation, after PDF generation, and picks up every `pdfs` row not yet sent for review (`telegram_sent_at is null`, capped at `PDF_REVIEW_PER_RUN` — `lib/config.ts`, starts at 5).

For each one, sends the actual rendered PDF file to Telegram (`lib/telegram.ts` `sendDocument` — passes the PDF's already-public Supabase Storage URL straight through, Telegram fetches it server-side, no re-upload needed) with a caption showing the title and suggested price, and an inline **"✅ Approve for Publish"** button. This is a genuine review step, not a rubber stamp — the builder can actually open and read the attached PDF before approving.

Tapping it hits `api/telegram-webhook.ts`'s new `publish:` handler, which sets that cluster's `status` to `approved_for_publish` (deliberately *not* `published` — no Gumroad push has happened yet, step 9 isn't built, so claiming otherwise would misrepresent the data) and edits the message caption to confirm (`editMessageCaption`, not `editMessageText` — Telegram rejects `editMessageText` on a message with an attached document). `pdfs.telegram_sent_at` (`supabase/migrations/0007_pdfs_telegram_sent.sql`, run this one too) tracks what's already been sent so nothing repeats.

Until step 9's Gumroad API integration exists, this step doubles as the spec's manual-publish fallback ("bot sends the finished PDF + suggested listing copy for manual upload") — the sent message already has everything needed to list the guide on Gumroad by hand.

**To wire it up:**
1. Run `supabase/migrations/0007_pdfs_telegram_sent.sql` in the Supabase SQL editor.
2. No new API key needed — reuses the same Telegram bot from step 4.
3. Push/redeploy, then trigger `/api/cluster-problems?secret=<CRON_SECRET>` — response now includes a `reviewSent` count.
4. Check Telegram for a message with the actual PDF attached, a caption with title + price, and the "✅ Approve for Publish" button.
5. Tap it, then check `problem_clusters` in Supabase — that cluster's `status` should now read `approved_for_publish`.

**Confirmed working live, first try:** `reviewSent: 3` on the first run (3 pre-existing `pdfs` rows from earlier step 6 testing that had never been sent for review). All 3 PDFs arrived in Telegram with the file attached and price shown; approving one correctly edited the caption to "✅ Approved for publish."

## Step 8a: Companion blog draft + humanize pipeline

Also folded into `api/cluster-problems.ts`, same cron-limit reasoning as every step since 4. Runs at the end of every invocation, after the PDF review step, in two parts:

1. **Draft + humanize** (`lib/generateBlogPosts.ts`) — picks up clusters that already have a PDF (`status = 'drafted'`) but haven't been blog-drafted yet (`problem_clusters.blog_generated_at is null`, capped at `BLOG_PER_RUN` — `lib/config.ts`, starts at 3). Reuses the same `research_docs` content already generated in step 5, no separate research call. Two Gemini calls per cluster:
   - `lib/blogDraft.ts` — writes a free, partial post that stands on its own for SEO and ends by pointing at the linked PDF for the complete fix.
   - `lib/humanize.ts` (`humanizeContent` — shared with step 6's PDF generation as of 2026-07-24, originally blog-only) — a second pass that rewrites the draft against the spec's Guardrails humanize checklist (no em dashes, no inflated-parallelism or inflated-significance phrasing, varied sentence rhythm, a concrete detail, a genuine editorial opinion) — explicitly barred from inventing personal experience, credentials, or testimonials to satisfy that "real opinion" instruction, per the guardrail boundary in `docs/spec.md`.

   Both stages are stored in one `blog_posts` insert (`draft_content`, `final_content`, `status = 'humanized'`) rather than persisting an intermediate `'drafted'`-only row — the two Gemini calls happen synchronously in the same run.

2. **Send for review** (`lib/reviewBlogPosts.ts`) — sends every `status = 'humanized'` post not yet sent (`telegram_sent_at is null`, capped at `BLOG_REVIEW_PER_RUN`, starts at 5) to Telegram as a **preview**, not the full text — Telegram's `sendMessage` caps at 4096 characters and a full post can run past that, so this sends the word count plus the first 600 characters, with an inline **"✅ Approve"** button. The complete `final_content` is already in Supabase either way; approving here is a content-quality gate, not what determines what step 8b actually builds.

Tapping approve hits `api/telegram-webhook.ts`'s new `approve_blog:` handler, which sets that `blog_posts` row's `status` to `approved`. This doesn't publish anything — no site exists yet to publish to (that's step 8b).

**Guardrail note, called out explicitly per `docs/spec.md`'s instruction not to let these quietly drop:** the disclaimer boilerplate is deliberately *not* injected into `draft_content`/`final_content` here — same pattern as PDFs, where `lib/pdfTemplate.ts` injects it at render time rather than baking it into `research_docs`. The disclaimer text is now shared via `lib/disclaimer.ts` (extracted from `lib/pdfTemplate.ts` so both surfaces stay in sync). **Step 8b's site template must inject it — don't forget this when building that step.**

**To wire it up:**
1. Run `supabase/migrations/0008_blog_posts_tracking.sql` in the Supabase SQL editor (`problem_clusters.blog_generated_at`, `blog_posts.telegram_sent_at` — the `blog_posts` table itself already existed from `0001_init.sql`).
2. No new API key needed — reuses the same `GEMINI_API_KEY` from step 5.
3. Push/redeploy, then trigger `/api/cluster-problems?secret=<CRON_SECRET>` — response now includes `blogDrafted` and `blogReviewSent` counts.
4. Check the `blog_posts` table in Supabase for a new row with both `draft_content` and `final_content` populated.
5. Check Telegram for a preview message with a word count and an "✅ Approve" button.
6. Tap it, then check `blog_posts.status` in Supabase — should now read `approved`.
7. Read through `final_content` for a cluster and sanity-check the humanize pass actually did something — no em dashes, some sentence-length variation, a concrete detail, and critically: no fabricated personal claims ("I've fixed dozens of these...", etc.) — that would be a guardrail violation, not just a style miss, and should be reported back immediately if seen.

**Confirmed working live, first try:** `blogDrafted: 2, blogReviewSent: 2` on the first run. Both `blog_posts` rows landed with `draft_content` and `final_content` populated and a real `pdf_id` link. Telegram previews read genuinely well — real structure, a specific concrete citation (e.g. "NEC 408.4"), varied sentence rhythm, and correctly linked to the actual PDF file rather than a placeholder. No sign of fabricated personal experience or credentials — the humanize pass's guardrail boundary held. Tapped "✅ Approve" on one; `blog_posts.status` correctly flipped to `approved`.

**Real trust-gap caught after the site went live with real posts (2026-07-24):** for a thin-research question ("What's the first game with an all-female cast?"), the blog draft's CTA promised "a complete, chronological breakdown... from the earliest days of the arcade up through the golden age of home computers and RPGs" — but the actual PDF was a short "Short Answer" plus a couple of bullet points, nowhere near that promise. The blog draft is generated independently of the final PDF from the same research, so nothing was constraining it to (a) actually leave more in the PDF than it covered itself, or (b) avoid inventing CTA promises the research didn't support — for a thin-research topic, the free teaser could end up more substantial than the paid guide, inverted from the intended value proposition. `lib/blogDraft.ts`'s prompt now explicitly requires the PDF to always read as more substantial (shrink the teaser for thin research instead of padding it to a length target) and bars the CTA from promising specific content beyond what the research actually supports. Not yet re-tested live — needs a fresh cluster to go through blog drafting, since the already-published test posts predate this fix.

## Step 8b: Static site deploy

A new `site/` subdirectory — a separate Astro static site with its own `package.json`/build, deployed as a **second Vercel project** pointed at that subfolder. Same GitHub repo, no need to create a new one — Vercel supports importing the same repo twice with a different "Root Directory" per project.

**Why Astro, why a subfolder, why this deploy mechanism** (the three decisions from scoping this step):
- **Astro** over Next.js — this is Markdown content with no interactivity, exactly what Astro is built for, and it's lighter.
- **Subfolder of the existing repo** over a brand-new repo — avoids you having to create and manage a second GitHub repo; one `git push` updates both projects' source, even though only one of them actually needs to rebuild on any given change.
- **Supabase fetch at build time, triggered by a Vercel Deploy Hook** over committing Markdown files via GitHub API — this pipeline already talks to Supabase directly everywhere; a Deploy Hook is a single POST URL with no new auth/integration surface, versus adding GitHub API commit logic as a new capability.

**What the site does:**
- `site/src/lib/posts.ts` fetches every `blog_posts` row where `status` is `approved` or `published` at build time (server-side only — this is a fully static site, the Supabase service role key never reaches the browser).
- `site/src/pages/[slug].astro` renders one page per post — title, the shared disclaimer (`site/src/lib/disclaimer.ts`, kept in sync with `lib/disclaimer.ts` in the main repo — duplicated, not imported, since these are two separate deployable projects without shared package tooling), then the post body converted from Markdown via `marked`.
- `site/src/pages/index.astro` is a plain listing page linking to every post — real on-site navigation, not just a sitemap entry.
- **SEO mechanics, built in from the start rather than deferred:**
  - `@astrojs/sitemap` generates `sitemap-index.xml` automatically from the site's routes.
  - Each post gets its own `<title>`, `<meta name="description">`, and canonical URL — derived from that post's own content (`site/src/lib/postMeta.ts`), not one generic site-wide tag.
  - `site/src/pages/robots.txt.ts` generates `robots.txt` at build time from the real `PUBLIC_SITE_URL` (explicit `Allow: /` plus a `Sitemap:` line) rather than a static file that could silently ship a stale or accidentally indexing-blocked default — this is the failure mode that wouldn't show up as an error, just as zero organic traffic weeks later.

**On the pipeline side:** `lib/publishBlogPosts.ts` (wired into `api/cluster-problems.ts` as the last step) checks for any `blog_posts` still at `status = 'approved'`; if there's at least one, it fires the site's Deploy Hook once (covers everything pending in a single rebuild, since the site re-fetches all approved posts every time) and marks them `published` with a real `published_url`. It no-ops quietly — doesn't error, just returns 0 — until `VERCEL_DEPLOY_HOOK_URL` and `PUBLIC_SITE_URL` are actually set, so none of this can break the rest of the pipeline before the site exists.

**Verified before pushing:** `npm install` in `site/` completed clean, `npx astro check` returned 0 errors/warnings, and a build with dummy env vars got all the way through routing/config/sitemap/robots.txt generation and failed exactly where expected — the real Supabase network call, which this sandbox can't reach and a dummy URL doesn't resolve to anything. That's a strong signal the code itself is sound; the actual data-fetching and deploy behavior still needs a real test with your credentials.

**To wire it up (this one has real manual setup — no way around it, a second Vercel project is a real second thing to create):**
1. Run `supabase/migrations/0009_blog_posts_slug.sql` in the Supabase SQL editor.
2. In Vercel: **Add New Project** → import the same `problem-pdf-pipeline` GitHub repo again → before deploying, set **Root Directory** to `site`. Vercel should auto-detect the Astro framework preset.
3. On this **new** site project (not the main one), add environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (same values as the main project). Deploy.
4. Once deployed, copy the project's `*.vercel.app` URL. Go back into the site project's settings and add `PUBLIC_SITE_URL` set to that exact URL, then redeploy once so the sitemap/canonical/robots.txt actually use the real URL instead of the placeholder.
5. In the site project's settings → Git → **Deploy Hooks**, create one (any name, main branch) and copy the generated URL.
6. Back on the **main pipeline project's** Vercel env vars, add `VERCEL_DEPLOY_HOOK_URL` (the URL from step 5) and `PUBLIC_SITE_URL` (same value as step 4). Redeploy the main project.
7. Trigger `/api/cluster-problems?secret=<CRON_SECRET>` — response should include `blogPublished` > 0 if there's at least one cluster's blog post still sitting at `status = 'approved'` from step 8a testing (if there isn't one right now, approve a blog post in Telegram first, then re-trigger).
8. Check `blog_posts` in Supabase — the approved row(s) should now read `status = 'published'` with a real `published_url`.
9. Wait a minute or two for the site's rebuild to finish (check the Deployments tab on the site's Vercel project), then open `published_url` directly and confirm the post actually renders — title, disclaimer, body, working link back to the PDF.
10. Check `<published_url>/sitemap-index.xml` and `<published_url>/robots.txt` both load and reference real content, not the placeholder domain.

**Confirmed working live, end to end.** Hit two real issues during setup, both resolved:
- Vercel's mobile "Application Preset" picker never populated after selecting `site` as Root Directory — worked around by manually confirming the Build Command (`npm run build`) and Output Directory (`dist`) in Build and Output Settings instead; the build succeeded regardless, since Vercel actually detects the framework server-side from `package.json`, not from that display field.
- The Supabase service role key got mangled on a long mobile paste, producing "Invalid API key" on the first real deploy attempt (distinct from "Missing..." on the deploy before env vars were set — that distinction is what confirmed it was a bad value, not an absent one). Fixed by clearing the field and re-pasting carefully.
- One real data gap, not a code bug: the two `blog_posts` rows from step 8a testing predated the `slug` column (added in this step's migration), so their `published_url` came out as `.../null`. One-off SQL backfill fixed both rows; every post created after this point gets a real slug automatically since the column and the generation code shipped together.

## Step 9: Gumroad publish handoff

**Verified before writing any code, not after hitting an error:** checked Gumroad's own API docs plus multiple independent third-party integrations (two MCP servers built to expose Gumroad's API to AI agents, a Postman reference, a PyPI client — all of which would have needed this if it existed, and none of them have it) and a Gumroad GitHub issue explicitly requesting the feature. The finding is unambiguous: **Gumroad's public API cannot create a new product with a file, at all.** It supports reading/editing an *existing* product (enable/disable, variants, offer codes, custom fields) and reading sales data — nothing that creates one. The spec originally framed this as "API push, with manual handoff as a fallback while the integration is basic." That framing was wrong going in — manual handoff isn't a lesser fallback, it's the only version of step 9 that can exist. Updated `docs/spec.md` to say so plainly rather than leave the old assumption uncorrected.

Also folded into `api/cluster-problems.ts` as the final step, same pattern as everything since step 4. `lib/sendGumroadHandoff.ts` picks up every cluster at `status = 'approved_for_publish'` (the step 7 review gate) not yet handed off (`problem_clusters.gumroad_handoff_sent_at is null`, capped at `GUMROAD_HANDOFF_PER_RUN` — `lib/config.ts`, starts at 5), and for each one sends the actual PDF file to Telegram (`sendDocument`, same as step 7) with a caption containing generated listing copy — title, price, and a short description (`lib/gumroadListing.ts`, a plain template, no LLM call needed since the title and price already exist from steps 5/6) — plus an inline **"✅ Mark as Published"** button.

There's no API call here to actually create the listing — the caption's instructions are the deliverable: create the listing by hand in Gumroad's dashboard using the attached PDF and the generated copy, a couple minutes of manual work per guide. Tapping the button (`api/telegram-webhook.ts`'s new `gumroad_done:` handler) sets `pdfs.published_at` and flips `problem_clusters.status` to `published` — the true terminal status, finally accurate now that something has actually gone live. `pdfs.gumroad_url` is **not** captured automatically (there's no completion callback to wait on, unlike step 8b's deploy hook) — the caption tells the builder they can paste the real URL into Supabase manually if they want it tracked for the later sales-feedback scoring idea in the spec's "Pricing strategy" section.

`GUMROAD_ACCESS_TOKEN` (`.env.example`) is not needed for this step and no code currently reads it — kept for a later, unbuilt enhancement (toggling a listing live/hidden, pulling sales data back into scoring) that the API genuinely does support.

**To wire it up:**
1. Run `supabase/migrations/0010_problem_clusters_gumroad_handoff.sql` in the Supabase SQL editor.
2. No new API key needed — reuses the same Telegram bot as every other step.
3. Push/redeploy, then trigger `/api/cluster-problems?secret=<CRON_SECRET>` — response now includes a `gumroadHandoffSent` count. You'll need at least one cluster at `status = 'approved_for_publish'` from step 7 testing (if there isn't one right now, tap "Approve for Publish" on a PDF in Telegram first, then re-trigger).
4. Check Telegram for a message with the PDF attached, generated title/price/description, and the "✅ Mark as Published" button.
5. Actually go create the listing in Gumroad's dashboard using that material — real practice for the actual workflow this step exists to support.
6. Tap the button, then check `problem_clusters.status` in Supabase — should now read `published`, and `pdfs.published_at` should be set.

**Confirmed working live, first try:** `gumroadHandoffSent: 1` on the trigger run. Telegram message arrived with the PDF attached, correct title/price/generated description, clear manual-listing instructions, and the "✅ Mark as Published" button. Tapped it — `problem_clusters.status` correctly flipped to `published` and `pdfs.published_at` was set.

`blogPublished: 1` on the trigger run, `blog_posts.status` correctly flipped to `published` with a real `published_url`. Opened the live URL directly — title, disclaimer (identical wording to the PDF's), body content, and a working link back to the source PDF all rendered correctly. `sitemap-index.xml` and `robots.txt` both resolved with the real production domain (not the `example.vercel.app` placeholder), and `robots.txt` correctly allows indexing with a `Sitemap:` line pointing at the real sitemap.
