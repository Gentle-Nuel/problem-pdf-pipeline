import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { fetchSiteQuestions, questionText } from "../lib/stackexchange.js";
import { isRegulatedAdvice } from "../lib/blocklist.js";
import { SCRAPE_TARGETS, SCRAPE_LIMIT_PER_TARGET } from "../lib/config.js";
import { isAuthorizedCronRequest } from "../lib/cronAuth.js";
import { scrapeGooglePaa } from "../lib/scrapeGooglePaa.js";

// Triggered by Vercel Cron (see vercel.json). CRON_SECRET, if set, is
// required so the endpoint can't be triggered by anyone who finds the URL.
// Name is now slightly stale — this also runs the Google PAA
// cross-validation step (see below) — but the deployed cron path and
// Vercel function name aren't worth changing just for that.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseClient();
  const summary: Record<string, { fetched: number; submitted: number; blocked: number }> = {};
  const failed: { target: string; error: string }[] = [];

  // A single bad target (unknown site slug, transient API error, etc.)
  // must not abort every target after it — confirmed live this was a
  // real gap: an invalid site name for the last target in the array
  // crashed the whole endpoint with a 500 even though every earlier
  // target's rows were already safely committed by that point. Same
  // reasoning as lib/scrapeGooglePaa.ts's per-cluster resilience.
  for (const target of SCRAPE_TARGETS) {
    const key = target.tag ? `${target.site}:${target.tag}` : target.site;
    try {
      const questions = await fetchSiteQuestions(target.site, {
        tag: target.tag,
        limit: SCRAPE_LIMIT_PER_TARGET,
      });

      let blocked = 0;

      const rows = questions
        .filter((q) => {
          const text = questionText(q);
          if (isRegulatedAdvice(text)) {
            blocked++;
            return false;
          }
          return true;
        })
        .map((q) => ({
          source: "stackexchange",
          source_url: q.link,
          raw_text: questionText(q),
          engagement_score: Math.max(0, q.score),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("raw_problems")
          .upsert(rows, { onConflict: "source_url", ignoreDuplicates: true });

        if (error) {
          throw new Error(`Insert failed for ${key}: ${error.message}`);
        }
      }

      summary[key] = { fetched: questions.length, submitted: rows.length, blocked };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Scrape failed for target ${key}: ${message}`);
      failed.push({ target: key, error: message });
    }
  }

  // Cross-validate existing clusters against Google's autocomplete —
  // purely additive: writes new raw_problems rows for the existing
  // clustering cron to pick up, never touches the Stack Exchange results
  // above (already committed to the DB by this point regardless of
  // whether this step succeeds).
  const paa = await scrapeGooglePaa(supabase);

  return res.status(200).json({ ok: true, summary, failed, googlePaa: paa });
}
