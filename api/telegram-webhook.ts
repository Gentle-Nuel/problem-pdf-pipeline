import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseClient } from "../lib/supabase.js";
import { answerCallbackQuery, editMessageText } from "../lib/telegram.js";

interface TelegramUpdate {
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number }; text?: string };
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

  // Always 200 for anything we don't handle — a non-200 makes Telegram
  // retry the same update repeatedly.
  if (!callback || !callback.data?.startsWith("approve:")) {
    return res.status(200).json({ ok: true });
  }

  const clusterId = callback.data.slice("approve:".length);
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

  return res.status(200).json({ ok: true });
}
