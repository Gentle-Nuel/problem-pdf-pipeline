import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAutocompleteSuggestions } from "./googlePaa.js";
import { isRegulatedAdvice } from "./blocklist.js";
import { judgeSameProblem, type PaaJudgment } from "./paaJudge.js";
import { recomputeClusterAggregates } from "./clusterAggregates.js";
import { GOOGLE_PAA_CLUSTERS_PER_RUN } from "./config.js";

// Cross-validates existing clusters against Google's autocomplete
// suggestions — closes the gap flagged in docs/spec.md's Data sources
// section (Google PAA was listed as a secondary validation layer but
// never got its own build-order step).
//
// Merging is an LLM judgment call (see lib/paaJudge.ts), not embedding
// similarity: confirmed live that even topically-perfect PAA suggestions
// score well under the clustering threshold against their own source
// cluster, so the generic embedding-similarity clustering cron would
// essentially never merge these. Suggestions judged "same specific
// problem" are attached directly to their source cluster here; everything
// else (related-topic-but-different-problem, or a failed judgment call)
// still lands as a plain unclustered raw_problems row and flows through
// the existing clustering cron exactly as before — this file never
// touches clustering/scoring logic for anything except the direct-attach
// path it owns.
export async function scrapeGooglePaa(supabase: SupabaseClient): Promise<{
  checked: number;
  submitted: number;
  directlyAttached: number;
  failed: { clusterId: string; error: string }[];
}> {
  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text")
    .is("paa_checked_at", null)
    .order("score", { ascending: false })
    .limit(GOOGLE_PAA_CLUSTERS_PER_RUN);

  if (error) throw new Error(`Failed to load clusters for PAA check: ${error.message}`);
  if (!candidates || candidates.length === 0) return { checked: 0, submitted: 0, directlyAttached: 0, failed: [] };

  let submitted = 0;
  let directlyAttached = 0;
  const failed: { clusterId: string; error: string }[] = [];

  for (const cluster of candidates) {
    // representative_text is already just the source question's title (see
    // api/cluster-problems.ts) — short and specific. An earlier version of
    // this truncated to the first 6 words, which on titles phrased like
    // "Is it OK to relabel a main panel breaker?" strips exactly the words
    // that made it specific, leaving a generic stem ("Is it ok to relabel
    // a") that Google's autocomplete fills with unrelated popular queries.
    const query = (cluster.representative_text as string).trim();

    // A single bad query (Google 400s, transient network issue, etc.) must
    // not: (a) crash the whole run and lose progress on the candidates
    // already processed before it, or (b) leave this cluster's
    // paa_checked_at unset — since candidates are pulled highest-score-
    // first, an unset checked_at means the same failing cluster would be
    // first in line again on every future run, permanently jamming this
    // endpoint on one bad query.
    try {
      const suggestions = await fetchAutocompleteSuggestions(query);
      const filtered = suggestions.filter((s) => !isRegulatedAdvice(s));

      // A judgment-call failure (Gemini quota, malformed JSON, etc.) must
      // degrade to the pre-existing behavior — insert everything
      // unclustered — rather than losing these suggestions or counting
      // the whole cluster as failed.
      let judgments: PaaJudgment[] = [];
      try {
        judgments = await judgeSameProblem(query, filtered);
      } catch (judgeErr) {
        const message = judgeErr instanceof Error ? judgeErr.message : String(judgeErr);
        console.error(`PAA judgment failed for cluster ${cluster.id}, inserting unclustered instead: ${message}`);
      }
      const verdictBySuggestion = new Map(judgments.map((j) => [j.suggestion, j.verdict]));

      const sameTexts = filtered.filter((s) => verdictBySuggestion.get(s) === "same");
      const otherTexts = filtered.filter((s) => verdictBySuggestion.get(s) !== "same");

      const toRow = (text: string) => ({
        source: "google_paa",
        source_url: null,
        raw_text: text,
        engagement_score: 0,
      });

      if (otherTexts.length > 0) {
        const { error: insertErr } = await supabase.from("raw_problems").insert(otherTexts.map(toRow));
        if (insertErr) {
          throw new Error(`Failed to insert PAA suggestions for cluster ${cluster.id}: ${insertErr.message}`);
        }
        submitted += otherTexts.length;
      }

      if (sameTexts.length > 0) {
        const { data: inserted, error: insertErr } = await supabase
          .from("raw_problems")
          .insert(sameTexts.map(toRow))
          .select("id");
        if (insertErr) {
          throw new Error(`Failed to insert same-problem PAA suggestions for cluster ${cluster.id}: ${insertErr.message}`);
        }
        submitted += sameTexts.length;

        const memberRows = (inserted ?? []).map((r) => ({
          cluster_id: cluster.id as string,
          raw_problem_id: r.id as string,
        }));
        if (memberRows.length > 0) {
          const { error: memberErr } = await supabase.from("cluster_members").insert(memberRows);
          if (memberErr) {
            throw new Error(`Failed to attach PAA suggestions to cluster ${cluster.id}: ${memberErr.message}`);
          }
          directlyAttached += memberRows.length;
          await recomputeClusterAggregates(supabase, cluster.id as string);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`PAA check failed for cluster ${cluster.id} (query "${query}"): ${message}`);
      failed.push({ clusterId: cluster.id as string, error: message });
    }

    const { error: updateErr } = await supabase
      .from("problem_clusters")
      .update({ paa_checked_at: new Date().toISOString() })
      .eq("id", cluster.id);
    if (updateErr) throw new Error(`Failed to mark cluster ${cluster.id} PAA-checked: ${updateErr.message}`);
  }

  return { checked: candidates.length, submitted, directlyAttached, failed };
}
