import { requireEnv } from "./env.js";

// Same model as lib/gemini.ts — see that file's comment for why this
// specific pinned version (higher free-tier quota than -latest aliases).
const MODEL = "gemini-3.5-flash-lite";

export interface PaaJudgment {
  suggestion: string;
  verdict: "same" | "related" | "different";
}

// Cosine similarity can't reliably separate "same specific problem,
// different phrasing" from "same broad topic, different problem" — the
// embedding-similarity clustering used for Stack Exchange dedup was tried
// on Google PAA suggestions first and confirmed live (see docs/spec.md
// Data sources / cluster-diagnostics output) to fail wholesale on this
// register gap: a formal SE title and a colloquial autocomplete suggestion
// on the *same* narrow topic still scored well under the merge threshold.
// An LLM can reason about the two texts directly instead of collapsing
// them to one distance number. Batched one call per cluster (not per
// suggestion) to stay well inside Gemini's free-tier rate limits.
export async function judgeSameProblem(clusterText: string, suggestions: string[]): Promise<PaaJudgment[]> {
  if (suggestions.length === 0) return [];
  const apiKey = requireEnv("GEMINI_API_KEY");

  const prompt = `Source problem: "${clusterText}"

Candidate search suggestions:
${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

For each numbered candidate, judge whether it describes the exact same specific problem as the source (just phrased differently), a related problem on the same general topic, or a genuinely different problem. Respond with ONLY a JSON array, no other text, in this exact form:
[{"index": 1, "verdict": "same"}, {"index": 2, "verdict": "related"}, ...]
One entry per candidate, in order, using the candidate's number. verdict must be exactly "same", "related", or "different".`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini PAA judgment request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");

  // responseMimeType:"application/json" should make this a clean parse,
  // but the model isn't guaranteed to comply — fall back to extracting the
  // first JSON array in the text rather than trusting the whole response
  // is bare JSON.
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Gemini PAA judgment returned no parseable JSON: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as { index: number; verdict: string }[];

  return parsed
    .filter((p) => typeof p.index === "number" && suggestions[p.index - 1] !== undefined)
    .map((p) => ({
      suggestion: suggestions[p.index - 1] as string,
      verdict: p.verdict === "same" || p.verdict === "related" ? (p.verdict as "same" | "related") : "different",
    }));
}
