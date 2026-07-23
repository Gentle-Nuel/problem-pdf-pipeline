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
