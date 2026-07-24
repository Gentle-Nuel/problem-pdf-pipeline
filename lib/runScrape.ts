import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSiteQuestions, questionText } from "./stackexchange.js";
import { isRegulatedAdvice } from "./blocklist.js";
import { SCRAPE_TARGETS, SCRAPE_LIMIT_PER_TARGET } from "./config.js";
import { scrapeGooglePaa } from "./scrapeGooglePaa.js";

export interface ScrapeSummary {
  summary: Record<string, { fetched: number; submitted: number; blocked: number }>;
  failed: { target: string; error: string }[];
  googlePaa: Awaited<ReturnType<typeof scrapeGooglePaa>>;
}

// Shared by api/scrape-stackexchange.ts (cron) and api/telegram-webhook.ts
// (/scrape command) — same logic either way, just two different triggers.
export async function runScrape(supabase: SupabaseClient): Promise<ScrapeSummary> {
  const summary: ScrapeSummary["summary"] = {};
  const failed: ScrapeSummary["failed"] = [];

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
  const googlePaa = await scrapeGooglePaa(supabase);

  return { summary, failed, googlePaa };
}
