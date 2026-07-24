export interface ScrapeTarget {
  site: string;
  tag?: string;
}

// Starting sites, per the build order. Add more sites/tags once these are
// proven out end to end. Personal Finance & Money SE was deliberately left
// out — see docs/spec.md "Guardrails": that site's highest-engagement
// content is largely regulated financial advice, which conflicts with the
// regulated-advice blocklist rather than being caught cleanly by it.
export const SCRAPE_TARGETS: ScrapeTarget[] = [{ site: "diy" }, { site: "cooking" }];

export const SCRAPE_LIMIT_PER_TARGET = 25;

// Cosine similarity above which a new problem is merged into an existing
// cluster rather than starting a new one. Unvalidated starting guess —
// after the first real clustering run, spot-check a sample of clusters in
// Supabase: merges that shouldn't have happened -> raise this; obvious
// duplicates left unmerged -> lower it.
export const CLUSTER_SIMILARITY_THRESHOLD = 0.84;

// How many not-yet-notified clusters to send to Telegram per run, highest
// score first. Kept small so the builder isn't flooded on their phone.
export const CLUSTERS_TO_NOTIFY_PER_RUN = 5;

// How many approved-but-unresearched clusters to research per run. Each
// call involves web search + adaptive thinking and can take a while — kept
// small to stay comfortably inside the function's execution time limit.
export const RESEARCH_PER_RUN = 3;

// How many researched-but-undrafted clusters to render to PDF per run.
// Launching headless Chromium per PDF is the heaviest single step in this
// pipeline — kept small for the same execution-time-budget reason.
export const PDF_PER_RUN = 3;

// How many not-yet-PAA-checked clusters to cross-validate against Google's
// autocomplete per run — see lib/scrapeGooglePaa.ts.
export const GOOGLE_PAA_CLUSTERS_PER_RUN = 5;

// How many drafted-but-not-yet-sent PDFs to send to Telegram for
// pre-publish review per run — see lib/reviewPdfs.ts.
export const PDF_REVIEW_PER_RUN = 5;
