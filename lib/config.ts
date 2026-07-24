export interface ScrapeTarget {
  site: string;
  tag?: string;
}

// diy/cooking were the starting sites; gaming/outdoors added once the
// full pipeline (steps 1-9) was proven out end to end — same "safe
// practical problem, no regulated-advice surface" shape, no blocklist
// tension. "home-automation" was tried alongside them and removed —
// Stack Exchange's API returned "No site found for name `home-automation`"
// (a real live 400, not a slug-format issue), meaning this either isn't
// an independent Stack Exchange site at all or uses some other API site
// identifier. Don't re-add without live-verifying the actual site exists
// and its real `site` API parameter first — this project has been burned
// more than once now by adding an unverified name/slug and finding out
// live instead of checking first.
//
// Two sites deliberately NOT added despite being otherwise good
// candidates:
// - Personal Finance & Money SE — see docs/spec.md "Guardrails": its
//   highest-engagement content is largely regulated financial advice,
//   which conflicts with the regulated-advice blocklist rather than being
//   caught cleanly by it.
// - Pets SE — same shape of problem as Personal Finance: its
//   highest-engagement content skews into "is this normal / should I see
//   a vet" territory, i.e. health advice for animals.
// Electronics and Travel SE are plausible future additions but need
// tag-level scoping first, not whole-site inclusion — Electronics'
// mains-wiring-adjacent tags carry the same risk as DIY's electrical
// panel questions, and Travel's visa/immigration tags are regulated-advice-
// adjacent the same way Personal Finance is. Exact safe/unsafe tag slugs
// haven't been verified yet — don't add either without that check first.
export const SCRAPE_TARGETS: ScrapeTarget[] = [
  { site: "diy" },
  { site: "cooking" },
  { site: "gaming" },
  { site: "outdoors" },
];

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

// How many PDF'd-but-not-yet-blogged clusters to draft a companion blog
// post for per run. Two Gemini calls each (draft + humanize) — kept small
// for the same execution-time-budget reason as RESEARCH_PER_RUN.
export const BLOG_PER_RUN = 3;

// How many humanized-but-not-yet-sent blog posts to send to Telegram for
// review per run — see lib/reviewBlogPosts.ts.
export const BLOG_REVIEW_PER_RUN = 5;

// How many approved-for-publish-but-not-yet-handed-off PDFs to send to
// Telegram for manual Gumroad listing per run — see
// lib/sendGumroadHandoff.ts.
export const GUMROAD_HANDOFF_PER_RUN = 5;
