import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScore } from "./scoring.js";

// Recomputes source_count/total_engagement/score for one cluster from its
// full current membership (not a delta), so aggregates never drift out of
// sync with reality regardless of which code path added a member. Shared
// by api/cluster-problems.ts (generic embedding-similarity clustering) and
// lib/scrapeGooglePaa.ts (direct-attach on an LLM "same problem" verdict).
export async function recomputeClusterAggregates(
  supabase: SupabaseClient,
  clusterId: string,
): Promise<{ sourceCount: number; totalEngagement: number; score: number }> {
  const { data: memberIdRows, error: memberIdsErr } = await supabase
    .from("cluster_members")
    .select("raw_problem_id")
    .eq("cluster_id", clusterId);
  if (memberIdsErr) throw new Error(`Failed to load members for cluster ${clusterId}: ${memberIdsErr.message}`);

  const ids = (memberIdRows ?? []).map((m) => m.raw_problem_id as string);
  const { data: members, error: membersErr } = await supabase
    .from("raw_problems")
    .select("source, engagement_score")
    .in("id", ids);
  if (membersErr) throw new Error(`Failed to load raw_problems for cluster ${clusterId}: ${membersErr.message}`);

  const sourceCount = new Set((members ?? []).map((m) => m.source as string)).size;
  const totalEngagement = (members ?? []).reduce((sum, m) => sum + ((m.engagement_score as number) ?? 0), 0);
  const score = computeScore(sourceCount, totalEngagement);

  const { error: updateErr } = await supabase
    .from("problem_clusters")
    .update({ source_count: sourceCount, total_engagement: totalEngagement, score })
    .eq("id", clusterId);
  if (updateErr) throw new Error(`Failed to update cluster ${clusterId}: ${updateErr.message}`);

  return { sourceCount, totalEngagement, score };
}
