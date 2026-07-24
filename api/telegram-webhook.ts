import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { answerCallbackQuery, editMessageText, editMessageCaption } from "../lib/telegram.js";

interface TelegramUpdate {
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number }; text?: string; caption?: string };
  };
}

// Telegram calls this directly (not us), so it's authorized via the secret
// token Telegram attaches when the webhook is registered with
// secret_token — see README for the setWebhook call — rather than the
// CRON_SECRET pattern used on the cron-triggered endpoints.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && req.headers["x-telegram-bot-api-secret-token"] !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const update = req.body as TelegramUpdate;
  const callback = update.callback_query;

  if (callback?.data?.startsWith("approve:")) {
    await handleApprove(callback);
  } else if (callback?.data?.startsWith("publish:")) {
    await handlePublish(callback);
  } else if (callback?.data?.startsWith("approve_blog:")) {
    await handleApproveBlog(callback);
  } else if (callback?.data?.startsWith("gumroad_done:")) {
    await handleGumroadDone(callback);
  }

  // Always 200, including for anything we don't handle — a non-200 makes
  // Telegram retry the same update repeatedly.
  return res.status(200).json({ ok: true });
}

async function handleApprove(callback: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const clusterId = (callback.data as string).slice("approve:".length);
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("problem_clusters").update({ status: "approved" }).eq("id", clusterId);

  if (error) {
    await answerCallbackQuery(callback.id, "Failed to approve — check logs.");
    throw new Error(`Failed to approve cluster ${clusterId}: ${error.message}`);
  }

  await answerCallbackQuery(callback.id, "Approved ✅");

  if (callback.message) {
    const originalText = callback.message.text ?? "";
    await editMessageText(String(callback.message.chat.id), callback.message.message_id, `${originalText}\n\n✅ Approved`);
  }
}

// Marks the cluster behind a reviewed PDF ready to publish (spec step 7).
// Deliberately a distinct status from 'published' — this tap alone doesn't
// put anything on Gumroad, it just clears the review gate. Step 9
// (lib/sendGumroadHandoff.ts) picks up 'approved_for_publish' clusters
// from here and sends the actual manual-listing materials.
async function handlePublish(callback: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const pdfId = (callback.data as string).slice("publish:".length);
  const supabase = getSupabaseClient();

  const { data: pdf, error: pdfErr } = await supabase.from("pdfs").select("cluster_id").eq("id", pdfId).single();
  if (pdfErr || !pdf) {
    await answerCallbackQuery(callback.id, "Failed to find PDF — check logs.");
    throw new Error(`Failed to load pdf ${pdfId}: ${pdfErr?.message ?? "not found"}`);
  }

  const { error } = await supabase
    .from("problem_clusters")
    .update({ status: "approved_for_publish" })
    .eq("id", pdf.cluster_id as string);

  if (error) {
    await answerCallbackQuery(callback.id, "Failed to approve — check logs.");
    throw new Error(`Failed to approve cluster ${pdf.cluster_id} for publish: ${error.message}`);
  }

  await answerCallbackQuery(callback.id, "Approved for publish ✅");

  if (callback.message) {
    const originalCaption = callback.message.caption ?? "";
    await editMessageCaption(
      String(callback.message.chat.id),
      callback.message.message_id,
      `${originalCaption}\n\n✅ Approved for publish`,
    );
  }
}

// Marks a companion blog post's content-quality review as passed (spec
// step 8a's "Store + review" stage). This does not publish anything —
// step 8b's static site build is what actually makes final_content live.
async function handleApproveBlog(callback: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const blogPostId = (callback.data as string).slice("approve_blog:".length);
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("blog_posts").update({ status: "approved" }).eq("id", blogPostId);

  if (error) {
    await answerCallbackQuery(callback.id, "Failed to approve — check logs.");
    throw new Error(`Failed to approve blog post ${blogPostId}: ${error.message}`);
  }

  await answerCallbackQuery(callback.id, "Approved ✅");

  if (callback.message) {
    const originalText = callback.message.text ?? "";
    await editMessageText(String(callback.message.chat.id), callback.message.message_id, `${originalText}\n\n✅ Approved`);
  }
}

// Confirms the manual Gumroad listing is live (spec step 9). This tap is
// the whole "publish" event as far as this pipeline can automate it —
// Gumroad's API doesn't support creating a product with a file at all
// (verified live, see docs/spec.md), so there's no completion callback to
// wait on the way step 8b has for the site's deploy hook. gumroad_url
// stays whatever it already was (usually still null) — the caption this
// replies to already told the builder they can paste it into
// pdfs.gumroad_url in Supabase manually if they want it tracked.
async function handleGumroadDone(callback: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const pdfId = (callback.data as string).slice("gumroad_done:".length);
  const supabase = getSupabaseClient();

  const { data: pdf, error: pdfErr } = await supabase.from("pdfs").select("cluster_id").eq("id", pdfId).single();
  if (pdfErr || !pdf) {
    await answerCallbackQuery(callback.id, "Failed to find PDF — check logs.");
    throw new Error(`Failed to load pdf ${pdfId}: ${pdfErr?.message ?? "not found"}`);
  }

  const now = new Date().toISOString();

  const { error: pdfUpdateErr } = await supabase.from("pdfs").update({ published_at: now }).eq("id", pdfId);
  if (pdfUpdateErr) throw new Error(`Failed to mark pdf ${pdfId} published: ${pdfUpdateErr.message}`);

  const { error: clusterUpdateErr } = await supabase
    .from("problem_clusters")
    .update({ status: "published" })
    .eq("id", pdf.cluster_id as string);
  if (clusterUpdateErr) {
    throw new Error(`Failed to mark cluster ${pdf.cluster_id} published: ${clusterUpdateErr.message}`);
  }

  await answerCallbackQuery(callback.id, "Marked published ✅");

  if (callback.message) {
    const originalCaption = callback.message.caption ?? "";
    await editMessageCaption(
      String(callback.message.chat.id),
      callback.message.message_id,
      `${originalCaption}\n\n✅ Published`,
    );
  }
}
