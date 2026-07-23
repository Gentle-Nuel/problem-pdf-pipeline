-- Tracks which clusters have already been sent to Telegram so the
-- notify step doesn't re-send the same cluster every time it runs.
-- Telegram's callback_query payload already carries chat_id/message_id,
-- so no need to store those separately for the approve action to work.
alter table problem_clusters
  add column telegram_notified_at timestamptz;
