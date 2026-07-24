# Problem-to-PDF Pipeline — Build Spec

## What this is
An automated pipeline that finds real problems people are searching for online (starting with the Stack Exchange network), ranks them by cross-platform demand, researches solutions, generates a detailed PDF guide, and publishes it for sale on Gumroad. Built to run entirely in the cloud (Vercel + Supabase) so it needs no PC or local power to operate once deployed. Controlled and triggered from a phone via a Telegram bot.

## Constraints driving the design
- Builder has unreliable electricity access — the running system must not depend on a local machine being on.
- Build phase happens via Claude Code on mobile — tasks should be scoped so each can be handed to Claude Code as a self-contained session.
- Priority is getting a working, revenue-testable loop fast, not a polished v1. Ship the smallest working slice first.

## Tech stack
- **Hosting/compute:** Vercel (cron functions, API routes) — Puppeteer PDF rendering must use `@sparticuz/chromium`, not full Puppeteer, or the function exceeds Vercel's size/memory limits. Cron frequency and function timeout are gated by plan (Hobby = daily cron only, short timeouts) — budget for Pro from the start if the pipeline needs to run more than once a day or steps run long.
- **Database:** Supabase (Postgres)
- **Control interface:** Telegram bot
- **AI:** Gemini (research step — swapped from the original Claude plan: Anthropic's console requires a paid credit purchase up front, Gemini's free tier via aistudio.google.com doesn't. Easy to swap back later once funded — the original Claude implementation is in git history); **Voyage AI** for embeddings (Anthropic's recommended partner — Anthropic itself has no embeddings endpoint)
- **Sales:** Gumroad (API for publishing, or manual upload initially)
- **PDF generation:** Puppeteer via `@sparticuz/chromium` (HTML → PDF)
- **Repo:** standalone repo, separate from any existing app (this pipeline is unrelated to any other project)

## Data sources (MVP — in priority order)
1. **Stack Exchange network** — official API (`api.stackexchange.com`), no auth required to read public questions, content is CC BY-SA licensed with commercial reuse explicitly permitted (with attribution). Question score is the engagement signal. Starting sites: `diy.stackexchange.com` and `cooking.stackexchange.com`; expanded once the full pipeline was proven end to end to also include `gaming.stackexchange.com`, `outdoors.stackexchange.com`, and `photo.stackexchange.com` (Photography — note the site's API slug is `photo`, not `photography`) — same "safe practical problem" shape, no regulated-advice surface. A fourth addition, "Home Automation," was attempted alongside them and dropped — Stack Exchange's API returned "No site found for name `home-automation`" live, meaning either it isn't actually an independent Stack Exchange site or it uses a different API site identifier than assumed; see `lib/config.ts` before retrying. Personal Finance & Money SE and Pets SE were both deliberately excluded — see Guardrails below. Electronics SE and Travel SE are plausible future additions but need tag-level scoping (not whole-site inclusion) before adding — see `lib/config.ts`. Crafts, Blender, and Board & Card Games SE are noted as solid next-round candidates once this batch has run for a while.
2. **Google autocomplete** — free, low-effort validation layer. Scraping this technically violates Google's ToS but enforcement is soft; low risk. Note: this was in the original spec but fell through the cracks — it never got its own numbered build-order step, so it went unbuilt through steps 2–6 despite `problem_clusters.score` depending on `source_count`, which was always 1 (single source) until this was added. Implemented as a cross-validation pass rather than open-ended discovery: for each existing cluster not yet checked, query autocomplete with its `representative_text`, insert any suggestions as new `raw_problems` rows (`source = 'google_paa'`).
   - **Merging is an LLM judgment call, not embedding similarity.** The original plan was to let the existing embedding-similarity clustering cron merge these in "if similar enough." Confirmed live this doesn't work: even a Google autocomplete suggestion that's obviously about the exact same narrow topic as its source cluster (verified with a real example — a "metal roofing" DIY question and its own autocomplete suggestions) scored well under the clustering threshold, because a formal Stack Exchange question title and a short colloquial autocomplete phrasing sit far apart in embedding space regardless of topic — cosine similarity can't cleanly separate "same specific problem, different phrasing" from "same broad topic, different problem." Instead, each cluster's suggestions are sent to Gemini in one batched call (`lib/paaJudge.ts`) asking it to judge each one "same problem" / "related topic" / "different problem" against the source cluster's text. Only "same" suggestions are attached directly to that cluster (bumping its real `source_count`); everything else still lands as a normal unclustered `raw_problems` row and flows through the existing embedding-similarity clustering exactly as before, so it can still form its own new cluster. This keeps `CLUSTER_SIMILARITY_THRESHOLD` and the Stack-Exchange-to-Stack-Exchange dedup logic completely untouched.

**Cut from MVP:**
- **Reddit** — was the original primary source. Dropped after reviewing Reddit's Responsible Builder Policy, which prohibits commercializing data pulled via the API without express written approval — this pipeline's entire output (paid PDFs, monetized companion blog) is exactly that. Revisit only via Reddit's own commercial-approval process (contact form linked from the policy), as an addition alongside Stack Exchange, not a replacement for it.
- Quora and Amazon/app-store reviews both explicitly prohibit scraping in their ToS, and Amazon actively IP-blocks and has pursued scrapers legally. Not worth the risk for sources that were only secondary/tertiary anyway. Revisit later only via an official API or paid data provider if that signal is still wanted.

AnswerThePublic / AlsoAsked — optional later addition, not a dependency.

## Guardrails (content & liability)
Added now, before the first guide is ever generated, so these don't get discovered the hard way after something's already been sold.

- **Regulated-advice exclusion.** Maintain a keyword/site blocklist for health, legal, and financial advice categories (e.g. medical symptoms, legal disputes, investment/loan advice). Checked at scrape or approval time — matches get skipped or flagged, never clustered into the publishable pipeline. Auto-generated "expert" guidance sold for money in these categories is a materially different liability class than a "fix your printer" PDF. This is also why Personal Finance & Money SE and Pets SE aren't scrape targets: Personal Finance's highest-engagement content is largely investment/loan advice, and Pets' is largely "is this normal / should I see a vet" — i.e. health advice for animals. Both are the kind of advice this blocklist exists to keep out, so pointing the scraper at either whole site would mean relying on the blocklist as a primary filter rather than a backstop — better to just not source from there. (Electronics SE and Travel SE sit in between — mostly fine, but each has a tag cluster with the same shape of risk — mains-wiring for Electronics, visa/immigration for Travel — so if added later, scope to safe tags rather than the whole site.)
- **Standard disclaimer.** Every PDF and blog post template carries fixed boilerplate: informational only, not professional advice, consult a qualified professional for the relevant domain. Applies to all published content regardless of category — cheap insurance, no reason to make it conditional.
- **Humanize pass boundary.** The humanize step (`lib/humanize.ts` — originally blog-only, extended to PDFs too once a real sample showed the PDF reading noticeably more AI-generated than the blog post drawn from the same research) is stylistic only — sentence rhythm, concrete detail, editorial tone. It must not fabricate personal experience, credentials, or testimonials the builder doesn't actually have. "A real opinion" means genuine editorial framing on the topic, never an invented backstory or false claim of expertise.

**Implementation hook:** the exclusion blocklist belongs in step 2 (scrape) or step 3 (approve) of the build order below; the disclaimer boilerplate belongs in step 6 (PDF template) and step 8 (blog template); the humanize boundary is a prompt constraint on step 8's humanize pass. Call these out explicitly in each task's scope so they don't quietly drop out during a mobile Claude Code session.

## Database schema (Supabase)

```sql
-- Raw problems pulled directly from sources
create table raw_problems (
  id uuid primary key default gen_random_uuid(),
  source text not null,              -- 'stackexchange', 'google_paa', etc.
  source_url text,
  raw_text text not null,
  engagement_score int default 0,    -- upvotes, review count, etc.
  fetched_at timestamptz default now()
);

-- Deduplicated/clustered problems with a combined ranking score
create table problem_clusters (
  id uuid primary key default gen_random_uuid(),
  representative_text text not null, -- clearest phrasing of the problem
  source_count int default 0,        -- how many distinct sources it appeared on
  total_engagement int default 0,
  score numeric,                     -- computed rank
  status text default 'discovered',  -- discovered -> approved -> researched -> drafted -> approved_for_publish -> published
  created_at timestamptz default now()
);

-- Link table: which raw_problems belong to which cluster
create table cluster_members (
  cluster_id uuid references problem_clusters(id),
  raw_problem_id uuid references raw_problems(id),
  primary key (cluster_id, raw_problem_id)
);

-- Research output per cluster
create table research_docs (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid references problem_clusters(id),
  content text,                      -- structured research findings
  created_at timestamptz default now()
);

-- Final generated PDFs
create table pdfs (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid references problem_clusters(id),
  file_url text,
  title text,
  price numeric,
  gumroad_url text,
  published_at timestamptz
);
```

## Pipeline stages

1. **Scrape** — Vercel cron function polls the Stack Exchange API for target sites/tags, writes matches into `raw_problems`. Applies the regulated-advice blocklist here (or at approval, see Guardrails).
2. **Cluster + rank** — cron function pulls unclustered `raw_problems`, uses embeddings to group near-duplicates, computes score from `source_count` + `total_engagement`, writes/updates `problem_clusters`.
3. **Approve (via Telegram bot)** — bot posts top-ranked clusters to the builder's phone; a tap sets `status = 'approved'`.
4. **Research** — on approval, a function calls Gemini (with Google Search grounding) to research the approved problem, writes findings to `research_docs`.
5. **Draft + generate PDF** — research is structured into a guide and rendered to PDF. Section headers aren't fixed to "problem/causes/fix" — the research prompt (`lib/gemini.ts`) lets the model choose headers that fit the actual question (a troubleshooting problem and a factual "what's the first X" question don't fit the same shape), always ending in a Resources section. Content runs through the humanize pass (`lib/humanize.ts`) before rendering. Template includes the standard disclaimer boilerplate.
6. **Review (via Telegram bot)** — bot sends the rendered PDF itself (not just a summary) to the builder's phone before it goes live, with an "Approve for Publish" button. A tap sets `status = 'approved_for_publish'`. This is a deliberate gap-fill: without it, a shallow or wrong guide could go live unreviewed under the builder's store.
7. **Publish** — manual handoff, not an API push. **Verified against Gumroad's own API docs plus multiple independent third-party integrations (two MCP servers, a Postman reference, a PyPI client) that all enumerate the same capability set: Gumroad's API supports reading/editing an *existing* product (enable/disable, variants, offer codes, custom fields) and reading sales data — it does not support creating a new product with a file, full stop. A GitHub issue on Gumroad's own repo requesting exactly this feature confirms it isn't just undocumented, it doesn't exist.** This was originally scoped as "API push, or manual-handoff as a fallback while the API integration is basic" — it's not a fallback, it's the only option: on approval, the bot sends the finished PDF plus generated listing copy (title, price, description) to the builder's phone, and creating the actual Gumroad listing is a manual couple-minutes-per-guide step in Gumroad's dashboard. `GUMROAD_ACCESS_TOKEN` is still worth having later for what the API *does* support — toggling listings live/hidden, and pulling sales data back into cluster scoring (see "Pricing strategy" below) — just not for this step.

**Note on failure handling:** none of the above stages currently have retry/dead-letter logic — acceptable to skip for v0, but a failed research or PDF step will currently just die silently. Worth a basic error-logging step even before full retry logic exists.

## SEO notes (baked into the pipeline, not separate)
- PDF titles and Gumroad listing copy should reuse the exact phrasing from `representative_text` — that's already the keyword people search.
- Gumroad listing pages themselves don't rank well on their own — a short companion blog/Markdown post per published PDF, targeting the same phrase and linking to the paid listing, is doing the actual SEO work. This is load-bearing for the "SEO-driven discovery" premise, not a later nice-to-have — build it alongside step 7 (publish), not after.
- Long-tail, specific phrasing outperforms broad terms — prioritize clusters with specific, narrow problem statements over generic ones.

## Pricing strategy
- Tiered by research depth/effort: guides backed by fewer sources and a more surface-level fix sit at a lower price point; guides with deeper research (multiple root causes, more thorough step-by-step content) price higher.
- `research_docs` should carry a rough depth signal (e.g. number of sources consulted, word count) that a simple rule can map to a price tier on the `pdfs.price` column — avoids pricing being decided ad hoc per item.
- Later: feed actual Gumroad sales data back into cluster scoring, so "problem clusters like the ones that sold" outrank raw engagement score over time. Not needed for MVP. **Verified live (not needed to build yet, just confirmed so it doesn't need re-checking later): Gumroad's webhook system is real** — sales/refund/cancellation events can be pushed to a registered "ping" endpoint, confirmed against official docs, an npm client library, and multiple working GitHub integrations. This is a push, not a poll, which is the right mechanism for this feature when it gets built. Separately, and *not* confirmed: no evidence Gumroad's API exposes buyer messages/reviews (its "Community" per-product chat feature doesn't appear to be API-readable) — a buyer-feedback loop, if wanted later, would need a manual Community-tab check or an email-based flow, not a webhook.

## Companion blog post pipeline (SEO — see note above)

Runs alongside PDF generation, reusing the same research so no separate research step is needed.

1. **Generate draft** — a Gemini call (`lib/blogDraft.ts`) takes the `research_docs` content and writes a free-to-read post: a partial, genuinely useful answer to the problem, written to stand on its own and rank in search, ending with a link to the full PDF for the complete fix. Confirmed live this needs real constraints, not just "write a partial answer": the draft is generated independently of the final PDF, so without explicit limits it can (a) cover as much ground as a genuinely thin PDF, leaving nothing exclusive for the paid guide, and (b) invent a CTA promising specific depth/content the PDF doesn't actually deliver — a trust problem once real sales are involved. The prompt now explicitly requires the PDF to always read as more substantial than the post (shrinking the teaser for thin research rather than padding it to a length target) and bars the CTA from promising anything not actually supported by the research.
2. **Humanize pass** — a second pass rewrites the draft to strip AI-writing tells before anything publishes: no em dashes, no "it's not just X, it's Y" constructions, no inflated-significance language ("stands as a testament to..."), varied sentence length and rhythm, at least one specific/concrete detail instead of generic claims, and a real opinion or aside rather than flat neutral reporting. Stylistic only — see Guardrails above on the boundary against fabricated experience/credentials. This matters for reader trust as much as SEO — content that reads as obviously AI-generated undermines the "genuinely useful" premise the whole funnel depends on.
3. **Store + review** — saved to a `blog_posts` table; can ride the same pre-publish Telegram review tap as the PDF (one approval covers both, or a separate tap if tighter control is wanted).
4. **Publish** — pushed live via a Vercel-hosted static site (Next.js/Astro, Markdown-driven), triggered by a new approved row — either a rebuild/deploy or a GitHub API commit, depending on which site setup is used. Template includes the standard disclaimer boilerplate.

```sql
create table blog_posts (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid references problem_clusters(id),
  pdf_id uuid references pdfs(id),
  draft_content text,
  final_content text,
  status text default 'drafted',   -- drafted -> humanized -> approved -> published
  published_url text,
  published_at timestamptz
);
```

## Suggested build order for Claude Code sessions

1. Standalone repo setup + Supabase schema (the SQL above) + Voyage AI API key/connection
2. Stack Exchange scraper → `raw_problems` (starting sites: diy, cooking) + regulated-advice blocklist filter
2b. Google autocomplete cross-validation → `raw_problems` (`source = 'google_paa'`) — added after steps 2–6 were already built, closing a gap where this was in the spec's Data sources but never made it onto this list
3. Clustering + ranking cron function (using Voyage AI embeddings)
4. Telegram bot: list top clusters, approve action
5. Research step (Gemini + Google Search grounding) triggered by approval
6. PDF generation from research (using `@sparticuz/chromium`) + pricing tier logic + disclaimer boilerplate
7. Pre-publish review tap (Telegram bot sends rendered PDF/summary, second tap to confirm)
8a. Companion blog draft + humanize pipeline, `blog_posts` table
8b. Static site setup + deploy trigger (separate task from 8a — different infra concerns)
9. Gumroad publish handoff — manual, not API (Gumroad's API doesn't support creating a product with a file at all, confirmed against official docs + multiple third-party integrations; see Pipeline stages step 7)

Each numbered item is scoped to be a standalone Claude Code task — build and test one before starting the next.
