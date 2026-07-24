import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { isAuthorizedCronRequest } from "../lib/cronAuth.js";
import { runScrape } from "../lib/runScrape.js";

// Triggered by Vercel Cron (see vercel.json), or on demand via the /scrape
// Telegram command (api/telegram-webhook.ts) — both call lib/runScrape.ts,
// this file just handles the cron's HTTP auth/request shape.
// Name is now slightly stale — this also runs the Google PAA
// cross-validation step (see lib/runScrape.ts) — but the deployed cron path
// and Vercel function name aren't worth changing just for that.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseClient();
  const result = await runScrape(supabase);

  return res.status(200).json({ ok: true, ...result });
}
