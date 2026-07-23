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
