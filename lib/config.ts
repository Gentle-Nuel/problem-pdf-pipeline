export interface ScrapeTarget {
  subreddit: string;
  query?: string;
}

// Single target to start, per the build order. Add more once this one is
// proven out end to end.
export const SCRAPE_TARGETS: ScrapeTarget[] = [{ subreddit: "techsupport" }];

export const SCRAPE_LIMIT_PER_TARGET = 25;
