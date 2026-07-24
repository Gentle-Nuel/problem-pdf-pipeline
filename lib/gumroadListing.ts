// Deterministic, no LLM call — title and price already exist on the pdfs
// row (lib/generatePdfs.ts, lib/pricing.ts), and a short templated
// description is good enough for a listing the builder is about to
// hand-create anyway. Not worth a third Gemini call per PDF for this.
export function buildGumroadListingCopy(title: string, price: number): { suggestedTitle: string; description: string } {
  return {
    suggestedTitle: title,
    description: `A complete, practical guide to: ${title}\n\nCovers the root causes, a step-by-step fix, and curated resources — no fluff, just what actually solves the problem.\n\nPrice suggestion: $${price} (see docs/spec.md "Pricing strategy" for the reasoning behind this tier).`,
  };
}
