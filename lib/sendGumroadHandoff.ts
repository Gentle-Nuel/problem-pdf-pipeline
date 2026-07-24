import type { SupabaseClient } from "@supabase/supabase-js";
import { sendDocument, escapeHtml } from "./telegram.js";
import { buildGumroadListingCopy } from "./gumroadListing.js";
import { requireEnv } from "./env.js";
import { GUMROAD_HANDOFF_PER_RUN } from "./config.js";

// Spec step 9 — verified live against Gumroad's own API docs plus multiple
// independent third-party integrations that this is NOT an API push: the
// public API supports reading/editing an *existing* product (enable/
// disable, variants, offer codes) and reading sales data, but does not
// support creating a new product with a file at all. So this step is a
// manual handoff, not a fallback for a "basic" API integration — it's the
// only version of step 9 that can exist right now.
//
// Sends the finished PDF + generated listing copy to Telegram for every
// cluster that's been through the step 7 review tap (status =
// 'approved_for_publish') but hasn't had this handoff sent yet
// (gumroad_handoff_sent_at is null). The builder creates the actual
// Gumroad listing by hand from this message, then taps "Mark as
// Published" (api/telegram-webhook.ts's gumroad_done: handler) once it's
// live.
export async function sendGumroadHandoff(supabase: SupabaseClient): Promise<number> {
  const chatId = requireEnv("TELEGRAM_CHAT_ID");

  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text")
    .eq("status", "approved_for_publish")
    .is("gumroad_handoff_sent_at", null)
    .not("score", "is", null)
    .order("score", { ascending: false })
    .limit(GUMROAD_HANDOFF_PER_RUN);

  if (error) throw new Error(`Failed to load clusters for Gumroad handoff: ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  for (const cluster of candidates) {
    const { data: pdfRows, error: pdfErr } = await supabase
      .from("pdfs")
      .select("id, file_url, price")
      .eq("cluster_id", cluster.id)
      .limit(1);
    if (pdfErr) throw new Error(`Failed to load pdf for cluster ${cluster.id}: ${pdfErr.message}`);
    const pdf = pdfRows?.[0];
    if (!pdf) throw new Error(`No pdf found for cluster ${cluster.id} despite status=approved_for_publish`);

    const { data: researchRows, error: researchErr } = await supabase
      .from("research_docs")
      .select("humanized_content")
      .eq("cluster_id", cluster.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (researchErr) {
      throw new Error(`Failed to load research for cluster ${cluster.id}: ${researchErr.message}`);
    }
    const humanizedContent = researchRows?.[0]?.humanized_content as string | undefined;
    if (!humanizedContent) {
      throw new Error(`No humanized_content found for cluster ${cluster.id} despite status=approved_for_publish`);
    }

    const title = cluster.representative_text as string;
    const { description } = buildGumroadListingCopy(title, pdf.price as number, humanizedContent);

    const caption = [
      `<b>Ready to list on Gumroad</b>`,
      "",
      `<b>${escapeHtml(title)}</b>`,
      `Price: $${pdf.price}`,
      "",
      escapeHtml(description),
      "",
      "Create the listing in Gumroad's dashboard using the attached PDF and the copy above, then tap the button once it's live.",
      "",
      "Optional: paste the resulting Gumroad URL into pdfs.gumroad_url in Supabase if you want it tracked for later sales-feedback scoring — the button below just marks it published, it doesn't capture the URL.",
    ].join("\n");

    await sendDocument(chatId, pdf.file_url as string, caption, [
      [{ text: "✅ Mark as Published", callback_data: `gumroad_done:${pdf.id}` }],
    ]);
  }

  const sentIds = candidates.map((c) => c.id as string);
  const { error: updateErr } = await supabase
    .from("problem_clusters")
    .update({ gumroad_handoff_sent_at: new Date().toISOString() })
    .in("id", sentIds);
  if (updateErr) throw new Error(`Failed to mark clusters Gumroad-handoff-sent: ${updateErr.message}`);

  return candidates.length;
}
