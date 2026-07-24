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
const SYSTEM_PROMPT = `You write free, genuinely useful blog posts that drive SEO traffic toward a paid PDF guide built from the same research. Given research findings for a specific problem, write a post that:
- Answers the problem partially and honestly — enough that a reader gets real value and the post can stand on its own and rank in search
- Stops meaningfully short of the full guide. The paid PDF must always read as more substantial than this post, never the other way around. If the research below is itself short or thin, write an even shorter post — do not pad it out to hit a length target, and do not cover so much ground that there's nothing left for the paid guide to add.
- Ends by pointing the reader to the linked guide, described honestly — do not promise specific content, structure, or depth (e.g. "a complete chronological breakdown") beyond what the research below actually supports. When in doubt, undersell rather than oversell.
- Is plain Markdown, starting with a single # title line
- Does not fabricate personal experience, credentials, or testimonials the writer doesn't have`;

// Reuses research_docs content directly — no separate research/search step,
// per docs/spec.md's companion blog pipeline note.
export async function draftBlogPost(problemStatement: string, researchContent: string, guideUrl: string): Promise<string> {
  const apiKey = requireEnv("GEMINI_API_KEY");

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
                text: `Problem: "${problemStatement}"\n\nResearch findings to draw from:\n${researchContent}\n\nLink to the full guide: ${guideUrl}\n\nWrite the blog post now.`,
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
