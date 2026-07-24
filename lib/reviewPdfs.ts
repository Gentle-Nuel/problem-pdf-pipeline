import type { SupabaseClient } from "@supabase/supabase-js";
import { sendDocument, escapeHtml } from "./telegram.js";
import { requireEnv } from "./env.js";
import { PDF_REVIEW_PER_RUN } from "./config.js";

// Sends each drafted-but-not-yet-sent PDF to Telegram for a pre-publish
// review (spec step 7) — the actual rendered file plus price context, with
// an inline "Approve for Publish" button (handled by
// api/telegram-webhook.ts). This doubles as the manual-publish handoff
// docs/spec.md describes as the step 9 fallback ("bot sends the finished
// PDF + suggested listing copy for manual upload") until a real Gumroad
// API integration exists — the builder already has everything needed to
// list it by hand from this message alone.
export async function sendPdfsForReview(supabase: SupabaseClient): Promise<number> {
  const chatId = requireEnv("TELEGRAM_CHAT_ID");

  const { data: candidates, error } = await supabase
    .from("pdfs")
    .select("id, cluster_id, file_url, title, price")
    .is("telegram_sent_at", null);

  if (error) throw new Error(`Failed to load pdfs for review: ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  // pdfs has no score column of its own — every other stage in this
  // pipeline prioritizes by problem_clusters.score, so join back to it
  // here too rather than ordering by price (which only loosely correlates
  // with rank).
  const clusterIds = candidates.map((p) => p.cluster_id as string);
  const { data: clusters, error: clustersErr } = await supabase
    .from("problem_clusters")
    .select("id, score")
    .in("id", clusterIds);
  if (clustersErr) throw new Error(`Failed to load cluster scores for pdf review ordering: ${clustersErr.message}`);

  const scoreByClusterId = new Map((clusters ?? []).map((c) => [c.id as string, (c.score as number) ?? 0]));
  const ordered = candidates
    .slice()
    .sort(
      (a, b) =>
        (scoreByClusterId.get(b.cluster_id as string) ?? 0) - (scoreByClusterId.get(a.cluster_id as string) ?? 0),
    )
    .slice(0, PDF_REVIEW_PER_RUN);

  for (const pdf of ordered) {
    const caption = [
      `<b>${escapeHtml(pdf.title as string)}</b>`,
      "",
      `Suggested price: $${pdf.price}`,
      "",
      "Review the attached PDF, then approve to mark it ready to publish.",
    ].join("\n");

    await sendDocument(chatId, pdf.file_url as string, caption, [
      [{ text: "✅ Approve for Publish", callback_data: `publish:${pdf.id}` }],
    ]);
  }

  const sentIds = ordered.map((p) => p.id as string);
  const { error: updateErr } = await supabase
    .from("pdfs")
    .update({ telegram_sent_at: new Date().toISOString() })
    .in("id", sentIds);
  if (updateErr) throw new Error(`Failed to mark pdfs as sent for review: ${updateErr.message}`);

  return ordered.length;
}
