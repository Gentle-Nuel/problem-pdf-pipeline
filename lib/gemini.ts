import { requireEnv } from "./env.js";

// gemini-2.5-flash 404'd ("no longer available to new users");
// gemini-flash-latest and gemini-flash-lite-latest both still 429'd — the
// rate-limit dashboard shows the higher quota (RPM 15 / RPD 500) only on
// the newer generation explicitly (Gemini 3.1/3.5 Flash Lite), while
// Gemini 2.5 Flash Lite shares the same restrictive RPD 20 as regular
// Flash. The "-latest" aliases apparently don't resolve to the
// high-quota model, so pinning directly instead of aliasing — accepting
// the staleness risk this time in exchange for a quota tier confirmed via
// both the model list and the rate-limit table.
const MODEL = "gemini-3.5-flash-lite";

const SYSTEM_PROMPT = `You are researching a specific problem for a paid how-to guide, drawing on your training knowledge — live web search is not available in this pipeline right now. Write your findings as clean Markdown with exactly these sections, in this order:

## Problem
## Root Causes
## Step-by-Step Fix
## Resources

Be concrete and specific rather than generic — this content becomes a guide someone is paying for. Under Resources, only list sources you're genuinely confident actually exist — well-known official documentation, standards bodies, major publications. Do not invent plausible-sounding URLs or article titles. If you're not confident about something, say so rather than guessing.`;

export async function researchProblem(problemStatement: string, examples: string[]): Promise<string> {
  const apiKey = requireEnv("GEMINI_API_KEY");

  const exampleBlock = examples.length
    ? `\n\nHow people are actually describing this problem:\n${examples.map((e) => `- ${e.split("\n\n")[0]}`).join("\n")}`
    : "";

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
                text: `Research this problem and write the guide content: "${problemStatement}"${exampleBlock}`,
              },
            ],
          },
        ],
        // Search grounding disabled: confirmed by testing that it's
        // specifically gated (likely requires billing) even though base
        // generation works fine on the free tier — four different models
        // all 429'd with grounding on, then succeeded immediately with it
        // off. Content is generated from training knowledge, not live
        // search; the system prompt above is written to reduce (not
        // eliminate) the resulting risk of fabricated citations under
        // "Resources" — spot-check links before publishing anything built
        // on this. Revisit once billing is available on either provider,
        // or bolt on a separate free search API and inject results into
        // the prompt manually.
        // tools: [{ google_search: {} }],
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("\n\n");

  if (!text.trim()) {
    throw new Error(`Gemini returned no text content. finishReason: ${candidate?.finishReason ?? "unknown"}`);
  }

  return text;
}
