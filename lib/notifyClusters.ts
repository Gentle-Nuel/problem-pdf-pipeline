import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, escapeHtml } from "./telegram.js";
import { requireEnv } from "./env.js";
import { CLUSTERS_TO_NOTIFY_PER_RUN } from "./config.js";

// Sends the highest-scoring not-yet-notified clusters to Telegram with an
// inline "Approve" button (handled by api/telegram-webhook.ts), then marks
// them notified so they aren't sent again on the next run.
export async function notifyTopClusters(supabase: SupabaseClient): Promise<number> {
  const chatId = requireEnv("TELEGRAM_CHAT_ID");

  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text, score, source_count, total_engagement")
    .is("telegram_notified_at", null)
    .eq("status", "discovered")
    .order("score", { ascending: false })
    .limit(CLUSTERS_TO_NOTIFY_PER_RUN);

  if (error) throw new Error(`Failed to load clusters to notify: ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  for (const cluster of candidates) {
    const { data: memberIdRows, error: memberIdsErr } = await supabase
      .from("cluster_members")
      .select("raw_problem_id")
      .eq("cluster_id", cluster.id);
    if (memberIdsErr) {
      throw new Error(`Failed to load members for cluster ${cluster.id}: ${memberIdsErr.message}`);
    }

    const ids = (memberIdRows ?? []).map((m) => m.raw_problem_id as string);
    const { data: members, error: membersErr } = await supabase
      .from("raw_problems")
      .select("source, source_url, engagement_score")
      .in("id", ids);
    if (membersErr) {
      throw new Error(`Failed to load raw_problems for cluster ${cluster.id}: ${membersErr.message}`);
    }

    const best = (members ?? []).sort(
      (a, b) => ((b.engagement_score as number) ?? 0) - ((a.engagement_score as number) ?? 0),
    )[0];

    const lines = [
      `<b>${escapeHtml(cluster.representative_text as string)}</b>`,
      "",
      `Score: ${cluster.score} · Sources: ${cluster.source_count} · Engagement: ${cluster.total_engagement}`,
    ];
    if (best?.source_url) {
      lines.push(`<a href="${best.source_url}">${escapeHtml(best.source as string)} source</a>`);
    }

    await sendMessage(chatId, lines.join("\n"), [[{ text: "✅ Approve", callback_data: `approve:${cluster.id}` }]]);
  }

  const notifiedIds = candidates.map((c) => c.id as string);
  const { error: updateErr } = await supabase
    .from("problem_clusters")
    .update({ telegram_notified_at: new Date().toISOString() })
    .in("id", notifiedIds);
  if (updateErr) throw new Error(`Failed to mark clusters notified: ${updateErr.message}`);

  return candidates.length;
}
