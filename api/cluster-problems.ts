import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { embedTexts } from "../lib/voyage.js";
import { cosineSimilarity } from "../lib/similarity.js";
import { computeScore } from "../lib/scoring.js";
import { CLUSTER_SIMILARITY_THRESHOLD } from "../lib/config.js";
import { isAuthorizedCronRequest } from "../lib/cronAuth.js";
import { notifyTopClusters } from "../lib/notifyClusters.js";
import { researchApprovedClusters } from "../lib/researchClusters.js";
import { generatePdfsForResearchedClusters } from "../lib/generatePdfs.js";

interface RawProblem {
  id: string;
  source: string;
  raw_text: string;
  engagement_score: number;
}

interface PoolCluster {
  id: string | null; // null until inserted (created this run)
  embedding: number[];
  isNew: boolean;
}

// Triggered by Vercel Cron (see vercel.json), scheduled after the scrape
// job so there's new data to work with.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseClient();

  // 1. Find raw_problems with no cluster_members row yet.
  const { data: clusteredRows, error: clusteredErr } = await supabase
    .from("cluster_members")
    .select("raw_problem_id");
  if (clusteredErr) throw new Error(`Failed to load cluster_members: ${clusteredErr.message}`);
  const clusteredIds = new Set((clusteredRows ?? []).map((r) => r.raw_problem_id as string));

  const { data: allRaw, error: rawErr } = await supabase
    .from("raw_problems")
    .select("id, source, raw_text, engagement_score");
  if (rawErr) throw new Error(`Failed to load raw_problems: ${rawErr.message}`);

  const unclustered = ((allRaw ?? []) as RawProblem[]).filter((r) => !clusteredIds.has(r.id));

  let newClustersCount = 0;
  let touchedClustersCount = 0;

  // Clustering only has work to do when there's something new — but
  // notification (below) should still run regardless, to catch up on any
  // backlog of clusters that haven't been sent to Telegram yet.
  if (unclustered.length > 0) {
    // 2. Load existing clusters' embeddings as the starting comparison pool.
    const { data: existingClusters, error: clustersErr } = await supabase
      .from("problem_clusters")
      .select("id, embedding");
    if (clustersErr) throw new Error(`Failed to load problem_clusters: ${clustersErr.message}`);

    const pool: PoolCluster[] = (existingClusters ?? [])
      .filter((c) => Array.isArray(c.embedding))
      .map((c) => ({ id: c.id as string, embedding: c.embedding as number[], isNew: false }));

    // 3. Embed every unclustered problem in one batch call.
    const embeddings = await embedTexts(unclustered.map((r) => r.raw_text));

    // 4. Greedy assignment: compare each new item against the pool
    // (existing clusters + any created earlier in this same run), attach
    // to the best match above threshold, else start a new cluster and add
    // it to the pool so later items in the batch can match against it too.
    const assignments: { rawProblemId: string; poolIndex: number; representativeText: string }[] = [];

    unclustered.forEach((raw, i) => {
      const embedding = embeddings[i];
      if (!embedding) return;

      let bestIndex = -1;
      let bestScore = -1;
      pool.forEach((cluster, idx) => {
        const sim = cosineSimilarity(embedding, cluster.embedding);
        if (sim > bestScore) {
          bestScore = sim;
          bestIndex = idx;
        }
      });

      if (bestIndex !== -1 && bestScore >= CLUSTER_SIMILARITY_THRESHOLD) {
        assignments.push({ rawProblemId: raw.id, poolIndex: bestIndex, representativeText: "" });
      } else {
        pool.push({ id: null, embedding, isNew: true });
        const title = raw.raw_text.split("\n\n")[0]?.trim() || raw.raw_text.slice(0, 140);
        assignments.push({ rawProblemId: raw.id, poolIndex: pool.length - 1, representativeText: title });
      }
    });

    // 5. Insert any new clusters to get real ids.
    const touchedPoolIndices = new Set(assignments.map((a) => a.poolIndex));

    for (const idx of touchedPoolIndices) {
      const cluster = pool[idx];
      if (cluster?.isNew) {
        const representativeText = assignments.find((a) => a.poolIndex === idx)?.representativeText || "Untitled problem";
        const { data: inserted, error: insertErr } = await supabase
          .from("problem_clusters")
          .insert({ representative_text: representativeText, embedding: cluster.embedding })
          .select("id")
          .single();
        if (insertErr) throw new Error(`Failed to create cluster: ${insertErr.message}`);
        cluster.id = inserted.id as string;
      }
    }

    // 6. Link every processed raw_problem to its cluster.
    const memberRows = assignments.map((a) => ({
      cluster_id: pool[a.poolIndex]?.id as string,
      raw_problem_id: a.rawProblemId,
    }));

    const { error: memberErr } = await supabase.from("cluster_members").insert(memberRows);
    if (memberErr) throw new Error(`Failed to insert cluster_members: ${memberErr.message}`);

    // 7. Recompute source_count/total_engagement/score for every touched
    // cluster from its full membership (not just this run's delta), so
    // aggregates never drift out of sync with reality.
    for (const idx of touchedPoolIndices) {
      const cluster = pool[idx];
      if (!cluster?.id) continue;

      const { data: memberIdRows, error: memberIdsErr } = await supabase
        .from("cluster_members")
        .select("raw_problem_id")
        .eq("cluster_id", cluster.id);
      if (memberIdsErr) {
        throw new Error(`Failed to load members for cluster ${cluster.id}: ${memberIdsErr.message}`);
      }

      const ids = (memberIdRows ?? []).map((m) => m.raw_problem_id as string);
      const { data: members, error: membersErr } = await supabase
        .from("raw_problems")
        .select("source, engagement_score")
        .in("id", ids);
      if (membersErr) {
        throw new Error(`Failed to load raw_problems for cluster ${cluster.id}: ${membersErr.message}`);
      }

      const sourceCount = new Set((members ?? []).map((m) => m.source as string)).size;
      const totalEngagement = (members ?? []).reduce((sum, m) => sum + ((m.engagement_score as number) ?? 0), 0);
      const score = computeScore(sourceCount, totalEngagement);

      const { error: updateErr } = await supabase
        .from("problem_clusters")
        .update({ source_count: sourceCount, total_engagement: totalEngagement, score })
        .eq("id", cluster.id);
      if (updateErr) throw new Error(`Failed to update cluster ${cluster.id}: ${updateErr.message}`);
    }

    newClustersCount = pool.filter((c) => c.isNew).length;
    touchedClustersCount = touchedPoolIndices.size;
  }

  // 8. Notify about the top not-yet-notified clusters, regardless of
  // whether this run clustered anything new.
  const notified = await notifyTopClusters(supabase);

  // 9. Research approved clusters — same reasoning as notify: runs every
  // time, not just when this invocation clustered something new.
  const researched = await researchApprovedClusters(supabase);

  // 10. Render PDFs for researched clusters.
  const drafted = await generatePdfsForResearchedClusters(supabase);

  return res.status(200).json({
    ok: true,
    processed: unclustered.length,
    newClusters: newClustersCount,
    touchedClusters: touchedClustersCount,
    notified,
    researched,
    drafted,
  });
}
