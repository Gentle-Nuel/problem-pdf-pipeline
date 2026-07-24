import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, escapeHtml } from "./telegram.js";
import { requireEnv } from "./env.js";
import { BLOG_REVIEW_PER_RUN } from "./config.js";

const PREVIEW_CHARS = 600;

// Sends each humanized-but-not-yet-sent blog post to Telegram for review
// (spec step 8a's "Store + review" stage) — a preview, not the full text:
// Telegram's sendMessage caps at 4096 characters and a full post can run
// past that. The complete final_content is already in Supabase for step
// 8b's site build to use; approving here is a content-quality gate, not
// the thing that determines what actually gets built.
export async function sendBlogPostsForReview(supabase: SupabaseClient): Promise<number> {
  const chatId = requireEnv("TELEGRAM_CHAT_ID");

  const { data: candidates, error } = await supabase
    .from("blog_posts")
    .select("id, cluster_id, final_content")
    .eq("status", "humanized")
    .is("telegram_sent_at", null);

  if (error) throw new Error(`Failed to load blog posts for review: ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  // blog_posts has no score column of its own — join back to
  // problem_clusters.score so this stage prioritizes the same way every
  // other stage in the pipeline does.
  const clusterIds = candidates.map((p) => p.cluster_id as string);
  const { data: clusters, error: clustersErr } = await supabase
    .from("problem_clusters")
    .select("id, score")
    .in("id", clusterIds);
  if (clustersErr) {
    throw new Error(`Failed to load cluster scores for blog review ordering: ${clustersErr.message}`);
  }

  const scoreByClusterId = new Map((clusters ?? []).map((c) => [c.id as string, (c.score as number) ?? 0]));
  const ordered = candidates
    .slice()
    .sort(
      (a, b) =>
        (scoreByClusterId.get(b.cluster_id as string) ?? 0) - (scoreByClusterId.get(a.cluster_id as string) ?? 0),
    )
    .slice(0, BLOG_REVIEW_PER_RUN);

  for (const post of ordered) {
    const content = post.final_content as string;
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
    const preview = content.length > PREVIEW_CHARS ? `${content.slice(0, PREVIEW_CHARS)}…` : content;

    const lines = [`<b>New companion blog post draft</b> (${wordCount} words)`, "", escapeHtml(preview)];

    await sendMessage(chatId, lines.join("\n"), [[{ text: "✅ Approve", callback_data: `approve_blog:${post.id}` }]]);
  }

  const sentIds = ordered.map((p) => p.id as string);
  const { error: updateErr } = await supabase
    .from("blog_posts")
    .update({ telegram_sent_at: new Date().toISOString() })
    .in("id", sentIds);
  if (updateErr) throw new Error(`Failed to mark blog posts as sent for review: ${updateErr.message}`);

  return ordered.length;
}
