import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBlogExcerpt, buildContinuationCta } from "./excerpt.js";
import { slugify } from "./slugify.js";
import { BLOG_PER_RUN } from "./config.js";

// Runs alongside PDF generation. No LLM calls here at all — the companion
// post is derived deterministically from research_docs.humanized_content,
// which lib/generatePdfs.ts already computed and persisted for every
// researched cluster regardless of whether a PDF got rendered.
//
// Picks up clusters ready for a companion post — either 'drafted' (has a
// PDF) or 'blog_only' (research was too thin for a paid product, see
// lib/generatePdfs.ts) — that haven't been blog-generated yet:
// - 'drafted': the post is an excerpt of the humanized content
//   (lib/excerpt.ts — first section only, by rule, never "Resources")
//   plus a programmatic CTA listing the real remaining section names.
// - 'blog_only': the post IS the humanized content, in full — nothing
//   held back, since there's no paid product for this topic at all.
//
// This replaces an earlier design where the blog post was independently
// drafted by its own Gemini call: confirmed live that let it (a) invent
// CTA promises the PDF didn't back up, and (b) cover as much ground as a
// thin PDF, leaving nothing exclusive behind the paywall. Deriving the
// post as a strict subset of the same already-humanized PDF content makes
// both problems structurally impossible rather than relying on prompt
// wording to avoid them.
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
    .in("status", ["drafted", "blog_only"])
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

    const { data: researchRows, error: researchErr } = await supabase
      .from("research_docs")
      .select("humanized_content")
      .eq("cluster_id", cluster.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (researchErr) {
      throw new Error(`Failed to load research for cluster ${cluster.id}: ${researchErr.message}`);
    }
    const humanized = researchRows?.[0]?.humanized_content as string | undefined;
    if (!humanized) {
      throw new Error(`No humanized_content found for cluster ${cluster.id} — expected lib/generatePdfs.ts to have set it`);
    }

    const title = cluster.representative_text as string;

    const body = pdf
      ? (() => {
          const { excerptBody, remainingSectionNames } = buildBlogExcerpt(humanized);
          const cta = buildContinuationCta(remainingSectionNames, pdf.file_url as string);
          return `${excerptBody}\n\n${cta}`;
        })()
      : humanized.trim();

    const content = `# ${title}\n\n${body}\n`;

    // Suffix with a short slice of the cluster id rather than retrying on
    // a unique-constraint conflict — two titles slugifying to the same
    // string is rare at this scale, and this avoids a conflict-retry loop
    // for a guarantee that's cheap to get up front instead.
    const slug = `${slugify(title)}-${(cluster.id as string).slice(0, 6)}`;

    // No separate "draft" stage anymore — draft_content and final_content
    // are identical, since there's nothing left to humanize (that already
    // happened upstream on the source content). Kept both columns rather
    // than migrating them away, to avoid unnecessary schema churn.
    const { error: insertErr } = await supabase.from("blog_posts").insert({
      cluster_id: cluster.id,
      pdf_id: pdf?.id ?? null,
      slug,
      draft_content: content,
      final_content: content,
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
