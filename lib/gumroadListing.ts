import { parseSections, joinSectionNames } from "./excerpt.js";

// Deterministic, no LLM call — title and price already exist on the pdfs
// row (lib/generatePdfs.ts, lib/pricing.ts). The "covers" list is derived
// from the PDF's actual section headers (same real-headers-only approach as
// lib/excerpt.ts's continuation CTA) rather than a fixed sentence.
//
// The original version hardcoded "Covers the root causes, a step-by-step
// fix..." for every guide — a leftover from when every PDF used that rigid
// structure. Confirmed live this went stale the moment research structure
// became flexible (lib/gemini.ts): a factual/trivia guide ("What's the
// first game with an all-female cast?") got sent to Gumroad promising
// "root causes" and "a step-by-step fix" it doesn't have and couldn't have,
// misdescribing the product to a buyer.
//
// The opening line has the same trap: "A complete, practical guide to:
// {title}" assumes title is a task/topic phrase, but representative_text
// is always a scraped question (that's what an SE title is) — practical
// ("Is it ok to relabel a breaker?") or purely factual ("What's the first
// game with an all-female cast?"). "Practical guide to: [trivia question]"
// doesn't parse. "This guide answers: {title}" fits either shape without
// needing to classify which one a given title is.
export function buildGumroadListingCopy(
  title: string,
  price: number,
  humanizedContent: string,
): { suggestedTitle: string; description: string } {
  const sections = parseSections(humanizedContent);
  const contentHeaders = sections.filter((s) => !/^resources$/i.test(s.header)).map((s) => s.header);
  const hasResources = sections.some((s) => /^resources$/i.test(s.header));
  const headerList = [...contentHeaders, ...(hasResources ? ["curated Resources"] : [])];

  const covers = headerList.length > 0 ? `The guide covers: ${joinSectionNames(headerList)}.` : "";

  return {
    suggestedTitle: title,
    description: `This guide answers: ${title}\n\n${covers}\n\nPrice suggestion: $${price} (see docs/spec.md "Pricing strategy" for the reasoning behind this tier).`,
  };
}
