import { requireEnv } from "./env.js";

function botUrl(method: string): string {
  return `https://api.telegram.org/bot${requireEnv("TELEGRAM_BOT_TOKEN")}/${method}`;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendMessage(
  chatId: string,
  text: string,
  buttons?: InlineButton[][],
): Promise<{ message_id: number } | null> {
  const res = await fetch(botUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { result?: { message_id: number } };
  return data.result ?? null;
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const res = await fetch(botUrl("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram answerCallbackQuery failed: ${res.status} ${await res.text()}`);
  }
}

// No parse_mode here deliberately — callback_query.message.text is plain
// text (Telegram strips formatting into a separate .entities array we're
// not reconstructing), so re-sending it as HTML risks parse errors on
// content that was never actually escaped for that.
export async function editMessageText(chatId: string, messageId: number, text: string): Promise<void> {
  const res = await fetch(botUrl("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram editMessageText failed: ${res.status} ${await res.text()}`);
  }
}
