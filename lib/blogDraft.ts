import { requireEnv } from "./env.js";

// Same pinned model as lib/gemini.ts and lib/paaJudge.ts — see lib/gemini.ts
// for why this specific version (higher free-tier quota than -latest
// aliases).
const MODEL = "gemini-3.5-flash-lite";

// Confirmed live this needed real constraints, not just "write a partial
// answer": without them, a blog draft can end up covering more ground
// than a genuinely thin PDF (nothing left for the paid guide to add), and
// its own CTA can promise specific depth/content ("a complete
// chronological breakdown of...") that the actual PDF doesn't deliver —
// a trust problem once real money is involved, not just a style issue.
// That in turn is what led to lib/generatePdfs.ts routing genuinely thin
// research to a PDF-less "blog_only" status instead of forcing a paid
// product to exist — hence the two modes below.
const SYSTEM_PROMPT = `You write free blog posts based on real research. Two modes — the user message tells you which one applies for this specific post:

1. A paid guide URL is given: write a partial, genuinely useful teaser. Stop meaningfully short of the full guide — the paid guide must always read as more substantial than this post, never the other way around. If the research is itself short or thin, write an even shorter post rather than padding it out or covering everything there is to know. End by pointing the reader to the linked guide, described honestly — do not promise specific content, structure, or depth (e.g. "a complete chronological breakdown") beyond what the research actually supports. When in doubt, undersell rather than oversell.
2. No paid guide URL is given: there is nothing to sell for this topic. Write a complete, standalone, genuinely thorough answer instead of a partial teaser — do not reference or imply that a paid guide exists.

In both modes:
- Answer honestly and specifically — enough that a reader gets real value and the post can stand on its own and rank in search
- Is plain Markdown, starting with a single # title line
- Does not fabricate personal experience, credentials, or testimonials the writer doesn't have`;

// Reuses research_docs content directly — no separate research/search step,
// per docs/spec.md's companion blog pipeline note. guideUrl is null for
// clusters routed to blog_only (lib/generatePdfs.ts) — no PDF exists to
// link to.
export async function draftBlogPost(
  problemStatement: string,
  researchContent: string,
  guideUrl: string | null,
): Promise<string> {
  const apiKey = requireEnv("GEMINI_API_KEY");

  const guideLine = guideUrl
    ? `Link to the full guide: ${guideUrl}`
    : "No paid guide exists for this topic — write a complete standalone post (mode 2 above).";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Problem: "${problemStatement}"\n\nResearch findings to draw from:\n${researchContent}\n\n${guideLine}\n\nWrite the blog post now.`,
              },
            ],
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini blog draft request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("\n\n");

  if (!text.trim()) {
    throw new Error(`Gemini returned no blog draft content. finishReason: ${candidate?.finishReason ?? "unknown"}`);
  }

  return text;
}
