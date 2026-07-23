import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAutocompleteSuggestions } from "./googlePaa.js";
import { isRegulatedAdvice } from "./blocklist.js";
import { GOOGLE_PAA_CLUSTERS_PER_RUN } from "./config.js";

// Cross-validates existing clusters against Google's autocomplete
// suggestions — closes the gap flagged in docs/spec.md's Data sources
// section (Google PAA was listed as a secondary validation layer but
// never got its own build-order step). Purely additive to raw_problems:
// new rows land with source='google_paa' and flow into the existing
// clustering cron unmodified — this file never touches clustering,
// scoring, or similarity logic.
export async function scrapeGooglePaa(supabase: SupabaseClient): Promise<{ checked: number; submitted: number }> {
  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text")
    .is("paa_checked_at", null)
    .order("score", { ascending: false })
    .limit(GOOGLE_PAA_CLUSTERS_PER_RUN);

  if (error) throw new Error(`Failed to load clusters for PAA check: ${error.message}`);
  if (!candidates || candidates.length === 0) return { checked: 0, submitted: 0 };

  let submitted = 0;

  for (const cluster of candidates) {
    // representative_text is already just the source question's title (see
    // api/cluster-problems.ts) — short and specific. An earlier version of
    // this truncated to the first 6 words, which on titles phrased like
    // "Is it OK to relabel a main panel breaker?" strips exactly the words
    // that made it specific, leaving a generic stem ("Is it ok to relabel
    // a") that Google's autocomplete fills with unrelated popular queries.
    const query = (cluster.representative_text as string).trim();
    const suggestions = await fetchAutocompleteSuggestions(query);

    const rows = suggestions
      .filter((s) => !isRegulatedAdvice(s))
      .map((s) => ({
        source: "google_paa",
        source_url: null,
        raw_text: s,
        engagement_score: 0,
      }));

    if (rows.length > 0) {
      const { error: insertErr } = await supabase.from("raw_problems").insert(rows);
      if (insertErr) {
        throw new Error(`Failed to insert PAA suggestions for cluster ${cluster.id}: ${insertErr.message}`);
      }
      submitted += rows.length;
    }

    const { error: updateErr } = await supabase
      .from("problem_clusters")
      .update({ paa_checked_at: new Date().toISOString() })
      .eq("id", cluster.id);
    if (updateErr) throw new Error(`Failed to mark cluster ${cluster.id} PAA-checked: ${updateErr.message}`);
  }

  return { checked: candidates.length, submitted };
}
