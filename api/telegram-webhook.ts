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
// Deliberately a distinct status from 'published' — no Gumroad push has
// actually happened yet (step 9 isn't built), so 'published' would be an
// inaccurate claim about the data. This is also the point where the
// builder already has everything needed (the sent PDF + title) to list it
// on Gumroad by hand in the meantime, per docs/spec.md's manual-fallback
// note for step 9.
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
