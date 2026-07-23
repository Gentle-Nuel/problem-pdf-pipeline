import { requireEnv } from "./env.js";
import { searchWeb } from "./tavily.js";

// gemini-2.5-flash 404'd ("no longer available to new users");
// gemini-flash-latest and gemini-flash-lite-latest both resolved to
// models with a restrictive free-tier quota (RPM 5 / RPD 20) and 429'd.
// gemini-3.5-flash-lite confirmed via the account's live rate-limit
// dashboard to have a much higher grant (RPM 15 / RPD 500) — the newer
// Flash-Lite generation gets that tier, older ones and regular Flash don't.
const MODEL = "gemini-3.5-flash-lite";

const SYSTEM_PROMPT = `You are researching a specific problem for a paid how-to guide. You've been given real web search results below — use them as your primary source for accuracy and for the Resources section. Write your findings as clean Markdown with exactly these sections, in this order:

## Problem
## Root Causes
## Step-by-Step Fix
## Resources

Be concrete and specific rather than generic — this content becomes a guide someone is paying for. Under Resources, cite only the URLs actually provided in the search results below — do not invent sources. If the search results don't cover something you need, say so rather than guessing.`;

export async function researchProblem(problemStatement: string, examples: string[]): Promise<string> {
  const apiKey = requireEnv("GEMINI_API_KEY");

  // Gemini's own search grounding tool is billing-gated even on this
  // otherwise-free account (confirmed: identical request 429'd with
  // grounding on, succeeded immediately with it off). Tavily's free tier
  // (1,000 searches/month, no card) fills that gap — search ourselves,
  // hand the model real results instead of relying on training knowledge.
  const searchResults = await searchWeb(problemStatement);
  const searchBlock = searchResults.length
    ? searchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join("\n\n")
    : "(no search results found)";

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
                text: `Research this problem and write the guide content: "${problemStatement}"${exampleBlock}\n\nWeb search results:\n${searchBlock}`,
              },
            ],
          },
        ],
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
