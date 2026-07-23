import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAutocompleteSuggestions } from "./googlePaa.js";
import { isRegulatedAdvice } from "./blocklist.js";
import { GOOGLE_PAA_CLUSTERS_PER_RUN, GOOGLE_PAA_MAX_QUERY_LENGTH } from "./config.js";

// Google's autocomplete endpoint 400s past some undocumented length limit
// (confirmed live — see GOOGLE_PAA_MAX_QUERY_LENGTH). Cuts at the last word
// boundary within the limit rather than mid-word.
function truncateForAutocomplete(text: string): string {
  if (text.length <= GOOGLE_PAA_MAX_QUERY_LENGTH) return text;
  const cut = text.slice(0, GOOGLE_PAA_MAX_QUERY_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

// Cross-validates existing clusters against Google's autocomplete
// suggestions — closes the gap flagged in docs/spec.md's Data sources
// section (Google PAA was listed as a secondary validation layer but
// never got its own build-order step). Purely additive to raw_problems:
// new rows land with source='google_paa' and flow into the existing
// clustering cron unmodified — this file never touches clustering,
// scoring, or similarity logic.
export async function scrapeGooglePaa(
  supabase: SupabaseClient,
): Promise<{ checked: number; submitted: number; failed: { clusterId: string; error: string }[] }> {
  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text")
    .is("paa_checked_at", null)
    .order("score", { ascending: false })
    .limit(GOOGLE_PAA_CLUSTERS_PER_RUN);

  if (error) throw new Error(`Failed to load clusters for PAA check: ${error.message}`);
  if (!candidates || candidates.length === 0) return { checked: 0, submitted: 0, failed: [] };

  let submitted = 0;
  const failed: { clusterId: string; error: string }[] = [];

  for (const cluster of candidates) {
    // representative_text is already just the source question's title (see
    // api/cluster-problems.ts) — short and specific. An earlier version of
    // this truncated to the first 6 words, which on titles phrased like
    // "Is it OK to relabel a main panel breaker?" strips exactly the words
    // that made it specific, leaving a generic stem ("Is it ok to relabel
    // a") that Google's autocomplete fills with unrelated popular queries.
    const query = truncateForAutocomplete((cluster.representative_text as string).trim());

    // A single bad query (Google 400s, transient network issue, etc.) must
    // not: (a) crash the whole run and lose progress on the candidates
    // already processed before it, or (b) leave this cluster's
    // paa_checked_at unset — since candidates are pulled highest-score-
    // first, an unset checked_at means the same failing cluster would be
    // first in line again on every future run, permanently jamming this
    // endpoint on one bad query.
    try {
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

  return { checked: candidates.length, submitted, failed };
}
