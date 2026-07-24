import type { SupabaseClient } from "@supabase/supabase-js";
import { draftBlogPost } from "./blogDraft.js";
import { humanizeBlogPost } from "./blogHumanize.js";
import { slugify } from "./slugify.js";
import { BLOG_PER_RUN } from "./config.js";

// Runs alongside PDF generation, reusing research_docs content directly —
// no separate research step, per docs/spec.md's companion blog pipeline.
// Picks up clusters that already have a PDF (status = 'drafted') but
// haven't been blog-drafted yet, writes a free companion post pointing at
// that PDF, runs it through a humanize pass, and stores both stages.
//
// Deliberately does NOT inject the disclaimer boilerplate into
// draft_content/final_content — matches how lib/pdfTemplate.ts injects it
// at PDF-render time rather than baking it into research_docs. Step 8b's
// site template is where the disclaimer belongs for the blog; don't forget
// it there (see docs/spec.md "Guardrails").
export async function generateBlogPosts(supabase: SupabaseClient): Promise<number> {
  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text")
    .eq("status", "drafted")
    .is("blog_generated_at", null)
    .order("score", { ascending: false })
    .limit(BLOG_PER_RUN);

  if (error) throw new Error(`Failed to load clusters for blog drafting: ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  for (const cluster of candidates) {
    const { data: pdfRows, error: pdfErr } = await supabase
      .from("pdfs")
      .select("id, file_url")
      .eq("cluster_id", cluster.id)
      .limit(1);
    if (pdfErr) throw new Error(`Failed to load pdf for cluster ${cluster.id}: ${pdfErr.message}`);
    const pdf = pdfRows?.[0];
    if (!pdf) throw new Error(`No pdf found for cluster ${cluster.id} despite status=drafted`);

    const { data: researchRows, error: researchErr } = await supabase
      .from("research_docs")
      .select("content")
      .eq("cluster_id", cluster.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (researchErr) {
      throw new Error(`Failed to load research for cluster ${cluster.id}: ${researchErr.message}`);
    }
    const researchContent = researchRows?.[0]?.content as string | undefined;
    if (!researchContent) throw new Error(`No research_docs content found for cluster ${cluster.id}`);

    const title = cluster.representative_text as string;
    const draft = await draftBlogPost(title, researchContent, pdf.file_url as string);
    const final = await humanizeBlogPost(draft);

    // Suffix with a short slice of the cluster id rather than retrying on
    // a unique-constraint conflict — two titles slugifying to the same
    // string is rare at this scale, and this avoids a conflict-retry loop
    // for a guarantee that's cheap to get up front instead.
    const slug = `${slugify(title)}-${(cluster.id as string).slice(0, 6)}`;

    const { error: insertErr } = await supabase.from("blog_posts").insert({
      cluster_id: cluster.id,
      pdf_id: pdf.id,
      slug,
      draft_content: draft,
      final_content: final,
      status: "humanized",
    });
    if (insertErr) throw new Error(`Failed to save blog post for cluster ${cluster.id}: ${insertErr.message}`);

    const { error: updateErr } = await supabase
      .from("problem_clusters")
      .update({ blog_generated_at: new Date().toISOString() })
      .eq("id", cluster.id);
    if (updateErr) throw new Error(`Failed to mark cluster ${cluster.id} blog-generated: ${updateErr.message}`);
  }

  return candidates.length;
}
