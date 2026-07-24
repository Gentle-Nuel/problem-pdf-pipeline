import type { SupabaseClient } from "@supabase/supabase-js";

// Fires the Astro site's Vercel Deploy Hook whenever there's at least one
// approved blog post pending — the site re-fetches every status='approved'
// post from Supabase at build time (site/src/lib/posts.ts), so one hook
// call picks up everything pending in a single rebuild rather than one
// deploy per post.
//
// No deploy-completion confirmation — Vercel doesn't call back here, so
// marking a post 'published' happens right after the hook call succeeds,
// not after the build actually finishes. Optimistic, matching this
// pipeline's existing "acceptable to skip full retry/confirmation logic
// for v0" approach elsewhere (see docs/spec.md "Note on failure
// handling"). If a build fails, the post's published_url won't 404 for
// long — the next approved post triggers another rebuild anyway.
export async function publishApprovedBlogPosts(supabase: SupabaseClient): Promise<number> {
  const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  const siteUrl = process.env.PUBLIC_SITE_URL;
  // Both are optional until the site's Vercel project actually exists —
  // skip quietly rather than block the rest of the pipeline on a step
  // that hasn't been wired up yet.
  if (!deployHookUrl || !siteUrl) return 0;

  const { data: candidates, error } = await supabase.from("blog_posts").select("id, slug").eq("status", "approved");

  if (error) throw new Error(`Failed to load approved blog posts: ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  const hookRes = await fetch(deployHookUrl, { method: "POST" });
  if (!hookRes.ok) {
    throw new Error(`Vercel deploy hook failed: ${hookRes.status} ${await hookRes.text()}`);
  }

  const now = new Date().toISOString();
  const baseUrl = siteUrl.replace(/\/$/, "");

  for (const post of candidates) {
    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({ status: "published", published_url: `${baseUrl}/${post.slug}`, published_at: now })
      .eq("id", post.id);
    if (updateErr) throw new Error(`Failed to mark blog post ${post.id} published: ${updateErr.message}`);
  }

  return candidates.length;
}
