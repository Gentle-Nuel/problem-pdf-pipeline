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
