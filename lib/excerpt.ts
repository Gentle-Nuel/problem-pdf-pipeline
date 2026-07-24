import { wordCount } from "./pricing.js";

interface Section {
  header: string;
  body: string;
}

// Splits on level-2 Markdown headers ("## Header"). Matches the shape the
// research prompt (lib/gemini.ts) always produces: a few content sections
// followed by a mandatory "## Resources" section.
function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match?.[1]) {
      if (current) sections.push(current);
      current = { header: match[1].trim(), body: "" };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) sections.push(current);

  return sections;
}

export interface BlogExcerpt {
  excerptBody: string; // Markdown body for the blog post — no title, no Resources
  remainingSectionNames: string[]; // for the CTA — real headers not included above
}

// Deterministic rule, no LLM call: the blog post is the title plus the
// FIRST content section of the (already humanized) PDF content, verbatim.
// "Resources" is never included in the excerpt — it's an intentional extra
// reason to buy, not just an accident of where the cut lands.
//
// Safety bound: if the first section alone is more than half the total
// content word count (or there's only one content section at all), the
// excerpt is truncated to roughly half the total words instead, cut at the
// nearest paragraph break — so the PDF is never left with less than half
// the material no matter how a given response happens to be structured.
//
// Confirmed live this whole approach was needed: independently generating
// the blog post let it (a) invent CTA promises the PDF didn't back up, and
// (b) cover as much ground as a thin PDF, leaving nothing exclusive behind
// the paywall. Deriving the blog as a strict subset of the PDF content
// makes both of those structurally impossible rather than relying on
// prompt wording to avoid them.
export function buildBlogExcerpt(humanizedContent: string): BlogExcerpt {
  const allSections = parseSections(humanizedContent);
  const contentSections = allSections.filter((s) => !/^resources$/i.test(s.header));
  const hasResources = allSections.some((s) => /^resources$/i.test(s.header));

  if (contentSections.length === 0) {
    // Shouldn't happen given the minimum-depth gate upstream, but fail
    // safe rather than crash the run over an unexpected content shape.
    return { excerptBody: humanizedContent.trim(), remainingSectionNames: [] };
  }

  const totalWords = contentSections.reduce((sum, s) => sum + wordCount(s.body), 0);
  const firstSection = contentSections[0] as Section;
  const firstSectionWords = wordCount(firstSection.body);

  let excerptBody: string;

  if (contentSections.length >= 2 && firstSectionWords <= totalWords / 2) {
    excerptBody = `## ${firstSection.header}\n\n${firstSection.body.trim()}`;
  } else {
    const targetWords = Math.floor(totalWords / 2);
    const paragraphs = firstSection.body.trim().split(/\n\s*\n/);
    let acc = "";
    let accWords = 0;
    for (const para of paragraphs) {
      const paraWords = wordCount(para);
      if (accWords > 0 && accWords + paraWords > targetWords) break;
      if (accWords === 0 && paraWords > targetWords) {
        // A single paragraph alone exceeds the target (e.g. one dense
        // block with no internal paragraph breaks at all) — fall back to
        // sentence-level truncation within it instead of taking it whole,
        // which would defeat the whole point of the safety bound.
        const sentences = para.match(/[^.!?]+[.!?]+(?:\s+|$)/g) ?? [para];
        let sentAcc = "";
        let sentWords = 0;
        for (const sentence of sentences) {
          const sw = wordCount(sentence);
          if (sentWords > 0 && sentWords + sw > targetWords) break;
          sentAcc += sentence;
          sentWords += sw;
        }
        acc = sentAcc.trim() || para;
        accWords = wordCount(acc);
        break;
      }
      acc += (acc ? "\n\n" : "") + para;
      accWords += paraWords;
    }
    excerptBody = `## ${firstSection.header}\n\n${(acc || paragraphs[0] || "").trim()}`;
  }

  const remainingSectionNames = [
    ...contentSections.slice(1).map((s) => s.header),
    ...(hasResources ? ["curated Resources"] : []),
  ];

  return { excerptBody, remainingSectionNames };
}

// Programmatic, not LLM-written — lists real section headers that exist in
// the document rather than letting a model invent marketing copy about
// what's coming, which is exactly what caused the overselling problem
// this replaces.
export function buildContinuationCta(remainingSectionNames: string[], guideUrl: string): string {
  if (remainingSectionNames.length === 0) {
    return `Read the [complete guide](${guideUrl}) for the full breakdown.`;
  }

  const list =
    remainingSectionNames.length === 1
      ? remainingSectionNames[0]
      : `${remainingSectionNames.slice(0, -1).join(", ")}, and ${remainingSectionNames[remainingSectionNames.length - 1]}`;

  return `The complete guide also covers: ${list}. [Read the full guide here](${guideUrl}).`;
}
