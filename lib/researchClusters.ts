import type { SupabaseClient } from "@supabase/supabase-js";
import { researchProblem } from "./gemini.js";
import { RESEARCH_PER_RUN } from "./config.js";

// Researches the highest-scoring approved-but-unresearched clusters,
// writes findings to research_docs, and advances status to 'researched'.
export async function researchApprovedClusters(supabase: SupabaseClient): Promise<number> {
  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text")
    .eq("status", "approved")
    .order("score", { ascending: false })
    .limit(RESEARCH_PER_RUN);

  if (error) throw new Error(`Failed to load approved clusters: ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  for (const cluster of candidates) {
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
      .select("raw_text")
      .in("id", ids)
      .limit(3);
    if (membersErr) {
      throw new Error(`Failed to load raw_problems for cluster ${cluster.id}: ${membersErr.message}`);
    }

    const examples = (members ?? []).map((m) => m.raw_text as string);
    const content = await researchProblem(cluster.representative_text as string, examples);

    const { error: insertErr } = await supabase
      .from("research_docs")
      .insert({ cluster_id: cluster.id, content });
    if (insertErr) throw new Error(`Failed to save research for cluster ${cluster.id}: ${insertErr.message}`);

    const { error: updateErr } = await supabase
      .from("problem_clusters")
      .update({ status: "researched" })
      .eq("id", cluster.id);
    if (updateErr) throw new Error(`Failed to update cluster ${cluster.id} status: ${updateErr.message}`);
  }

  return candidates.length;
}
