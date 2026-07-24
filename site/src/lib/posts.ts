import { supabase } from "./supabase.js";

export interface BlogPost {
  id: string;
  slug: string;
  final_content: string;
  published_at: string | null;
}

// Both 'approved' and 'published' render. The main pipeline
// (lib/publishBlogPosts.ts) fires this site's rebuild and marks a post
// 'published' in the same step that triggers the build, so by the time
// this build actually runs the status is normally already 'published' —
// including 'approved' too just covers the rare race where a build
// queries mid-transition, so a post never silently fails to appear.
export async function getApprovedPosts(): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, slug, final_content, published_at")
    .in("status", ["approved", "published"])
    .not("slug", "is", null);

  if (error) throw new Error(`Failed to load blog posts: ${error.message}`);
  return (data ?? []) as BlogPost[];
}
