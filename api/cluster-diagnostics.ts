import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { cosineSimilarity } from "../lib/similarity.js";
import { isAuthorizedCronRequest } from "../lib/cronAuth.js";

// Manual-only diagnostic, not on a cron schedule. Reports the closest
// pairs among existing problem_clusters by embedding similarity, and a
// histogram of all pairwise scores — read against CLUSTER_SIMILARITY_THRESHOLD
// (lib/config.ts) to judge whether it's set too strict or too loose, using
// embeddings already computed rather than burning new Voyage calls.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseClient();

  const { data: clusters, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text, embedding");
  if (error) throw new Error(`Failed to load problem_clusters: ${error.message}`);

  const withEmbeddings = (clusters ?? []).filter(
    (c): c is { id: string; representative_text: string; embedding: number[] } => Array.isArray(c.embedding),
  );

  const pairs: { a: string; b: string; similarity: number }[] = [];
  const buckets = { "0.9+": 0, "0.8-0.9": 0, "0.7-0.8": 0, "0.6-0.7": 0, "0.5-0.6": 0, "<0.5": 0 };

  for (let i = 0; i < withEmbeddings.length; i++) {
    for (let j = i + 1; j < withEmbeddings.length; j++) {
      const itemA = withEmbeddings[i];
      const itemB = withEmbeddings[j];
      if (!itemA || !itemB) continue;

      const sim = cosineSimilarity(itemA.embedding, itemB.embedding);
      pairs.push({ a: itemA.representative_text, b: itemB.representative_text, similarity: sim });

      if (sim >= 0.9) buckets["0.9+"]++;
      else if (sim >= 0.8) buckets["0.8-0.9"]++;
      else if (sim >= 0.7) buckets["0.7-0.8"]++;
      else if (sim >= 0.6) buckets["0.6-0.7"]++;
      else if (sim >= 0.5) buckets["0.5-0.6"]++;
      else buckets["<0.5"]++;
    }
  }

  pairs.sort((x, y) => y.similarity - x.similarity);

  return res.status(200).json({
    ok: true,
    totalClusters: withEmbeddings.length,
    totalPairs: pairs.length,
    histogram: buckets,
    closestPairs: pairs.slice(0, 15).map((p) => ({ ...p, similarity: Number(p.similarity.toFixed(4)) })),
  });
}
