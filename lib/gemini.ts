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

const SYSTEM_PROMPT = `You are researching a specific problem for a paid how-to guide. Use Google Search grounding to find accurate, current, and specific information: root causes, official documentation, and community-verified fixes.

Write your findings as clean Markdown with exactly these sections, in this order:

## Problem
## Root Causes
## Step-by-Step Fix
## Resources

Be concrete and specific rather than generic — this content becomes a guide someone is paying for. List the sources you actually used under Resources as a Markdown link list. If you're not confident about something, say so rather than guessing.`;

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
        // TEMPORARILY DISABLED — diagnosing repeated 429s across four
        // different models. Search grounding may specifically require
        // billing enabled even on an otherwise-free-tier account (separate
        // gate from base text generation) — testing plain generation
        // without it to isolate whether that's the actual blocker.
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
