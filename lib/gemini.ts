import { requireEnv } from "./env.js";

// Model naming: my last verified reference point is training data from
// around January 2026, and I couldn't fetch Google's current docs live
// from this sandbox (same network restriction as everything else in this
// project). gemini-2.5-flash was the standard free-tier-friendly default
// around that time. If this 404s, check the model picker at
// aistudio.google.com and swap the string below.
const MODEL = "gemini-2.5-flash";

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
        // Grounds the response in live Google Search results rather than
        // training data alone. Tool shape per my last verified reference
        // (Gemini 2.0+ uses the bare `google_search` tool, replacing the
        // older `googleSearchRetrieval` config) — flag if this 400s,
        // Google's grounding-tool syntax has moved across API versions.
        tools: [{ google_search: {} }],
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
