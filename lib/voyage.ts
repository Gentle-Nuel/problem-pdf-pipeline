import { requireEnv } from "./env.js";

// voyage-3-lite: general-purpose, 512-dim, cheapest tier — plenty for
// near-duplicate clustering of short problem statements. Verify this model
// id is still current against Voyage's docs if embedding calls start
// failing; their catalog moves.
const MODEL = "voyage-3-lite";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("VOYAGE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: MODEL,
      // Both sides of every comparison in this pipeline are the same kind
      // of thing (problem statements), so "document" is used uniformly —
      // never mix in "query" mode for one-off asymmetric embeddings here.
      input_type: "document",
    }),
  });

  if (!res.ok) {
    throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
