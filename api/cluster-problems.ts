import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { isAuthorizedCronRequest } from "../lib/cronAuth.js";
import { runClusterPipeline } from "../lib/runClusterPipeline.js";

// Triggered by Vercel Cron (see vercel.json), scheduled after the scrape
// job so there's new data to work with — or on demand via the /cluster
// Telegram command (api/telegram-webhook.ts). Both call
// lib/runClusterPipeline.ts, this file just handles the cron's HTTP
// auth/request shape.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseClient();
  const result = await runClusterPipeline(supabase);

  return res.status(200).json({ ok: true, ...result });
}
