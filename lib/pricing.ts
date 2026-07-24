function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function countResourceLinks(content: string): number {
  return (content.match(/\[.+?\]\(https?:\/\/[^\s)]+\)/g) ?? []).length;
}

// Tiered by research depth, per the spec's pricing strategy — deeper
// guides (more sources, more content) price higher. Thresholds are an
// unvalidated starting guess; tune once real sales data shows what
// actually correlates with a guide selling (see docs/spec.md "Pricing
// strategy" on feeding sales data back into scoring later).
export function computePrice(content: string): number {
  const words = wordCount(content);
  const sources = countResourceLinks(content);

  if (words >= 700 && sources >= 4) return 14;
  if (words >= 400 && sources >= 2) return 9;
  return 5;
}

// Below this, a cluster shouldn't become a paid product at all — reuses
// the $9 tier's own word-count floor rather than inventing a new number.
// Confirmed live this matters: a real research doc for a thin factual
// question came out to ~250-300 words, well under this floor, and became
// a $5 "guide" that was barely more than the free companion post — a bad
// product regardless of how the free post's copy was worded. See
// lib/generatePdfs.ts, which routes anything under this to a blog-only
// post instead of generating a PDF.
const MIN_WORDS_FOR_PDF = 400;
const MIN_SOURCES_FOR_PDF = 1;

export function meetsMinimumDepthForPdf(content: string): boolean {
  return wordCount(content) >= MIN_WORDS_FOR_PDF && countResourceLinks(content) >= MIN_SOURCES_FOR_PDF;
}
