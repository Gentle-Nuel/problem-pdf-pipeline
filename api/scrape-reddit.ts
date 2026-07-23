import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { fetchSubredditPosts } from "../lib/reddit.js";
import { isRegulatedAdvice } from "../lib/blocklist.js";
import { SCRAPE_TARGETS, SCRAPE_LIMIT_PER_TARGET } from "../lib/config.js";

// Triggered by Vercel Cron (see vercel.json). CRON_SECRET, if set, is
// required so the endpoint can't be triggered by anyone who finds the URL.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (
    process.env.CRON_SECRET &&
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseClient();
  const summary: Record<string, { fetched: number; submitted: number; blocked: number }> = {};

  for (const target of SCRAPE_TARGETS) {
    const posts = await fetchSubredditPosts(target.subreddit, {
      query: target.query,
      limit: SCRAPE_LIMIT_PER_TARGET,
    });

    let blocked = 0;

    const rows = posts
      .filter((post) => !post.stickied)
      .filter((post) => {
        const text = `${post.title}\n\n${post.selftext ?? ""}`;
        if (isRegulatedAdvice(text)) {
          blocked++;
          return false;
        }
        return true;
      })
      .map((post) => ({
        source: "reddit",
        source_url: `https://reddit.com${post.permalink}`,
        raw_text: `${post.title}\n\n${post.selftext ?? ""}`.trim(),
        engagement_score: post.ups ?? 0,
      }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("raw_problems")
        .upsert(rows, { onConflict: "source_url", ignoreDuplicates: true });

      if (error) {
        throw new Error(`Insert failed for r/${target.subreddit}: ${error.message}`);
      }
    }

    summary[target.subreddit] = { fetched: posts.length, submitted: rows.length, blocked };
  }

  return res.status(200).json({ ok: true, summary });
}
