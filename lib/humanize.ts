import { requireEnv } from "./env.js";

// Same pinned model as lib/gemini.ts, lib/paaJudge.ts.
const MODEL = "gemini-3.5-flash-lite";

// Stylistic pass only — see docs/spec.md "Guardrails" on the boundary
// against fabricated experience/credentials. The "real opinion" instruction
// is deliberately paired with an explicit ban on inventing a backstory, so
// the model can't satisfy it by making something up.
//
// Called once per cluster, from lib/generatePdfs.ts only — the companion
// blog post no longer gets its own independent humanize pass (or its own
// draft at all). It's derived from this same humanized output
// (lib/excerpt.ts) instead, so "humanized once" covers both surfaces.
// Originally blog-only, then extended to also cover PDFs once a real PDF
// sample read noticeably more AI-generated than the blog post drawn from
// the same research; later unified into this single call site once the
// blog stopped being independently generated at all.
const SYSTEM_PROMPT = `Rewrite the given draft to remove signs of AI-generated writing, without changing its meaning or adding anything false. Specifically:
- No em dashes
- No "it's not just X, it's Y" or similar inflated-parallelism constructions
- No inflated-significance language (e.g. "stands as a testament to", "plays a crucial role")
- Vary sentence length and rhythm rather than a uniform cadence
- Include at least one specific, concrete detail rather than a generic claim
- Write with a real, genuine editorial opinion or aside somewhere in the piece, not flat neutral reporting

This is a stylistic pass only. Do not invent personal experience, credentials, anecdotes, or testimonials the writer doesn't actually have — a "real opinion" means genuine editorial framing on the topic itself, never a fabricated backstory. Preserve the existing Markdown section structure and heading names exactly as given — do not add, remove, or rename sections. Keep the same overall length. Output only the rewritten content, nothing else.`;

export async function humanizeContent(draft: string): Promise<string> {
  const apiKey = requireEnv("GEMINI_API_KEY");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: draft }] }],
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini humanize request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("\n\n");

  if (!text.trim()) {
    throw new Error(`Gemini returned no humanized content. finishReason: ${candidate?.finishReason ?? "unknown"}`);
  }

  return text;
}
