import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { fetchSiteQuestions, questionText } from "../lib/stackexchange.js";
import { isRegulatedAdvice } from "../lib/blocklist.js";
import { SCRAPE_TARGETS, SCRAPE_LIMIT_PER_TARGET } from "../lib/config.js";
import { isAuthorizedCronRequest } from "../lib/cronAuth.js";

// Triggered by Vercel Cron (see vercel.json). CRON_SECRET, if set, is
// required so the endpoint can't be triggered by anyone who finds the URL.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseClient();
  const summary: Record<string, { fetched: number; submitted: number; blocked: number }> = {};

  for (const target of SCRAPE_TARGETS) {
    const key = target.tag ? `${target.site}:${target.tag}` : target.site;
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
  }

  return res.status(200).json({ ok: true, summary });
}
