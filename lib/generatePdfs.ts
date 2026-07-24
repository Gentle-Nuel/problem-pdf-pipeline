import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPdfHtml } from "./pdfTemplate.js";
import { renderPdf } from "./pdf.js";
import { uploadPdf } from "./storage.js";
import { computePrice, meetsMinimumDepthForPdf } from "./pricing.js";
import { humanizeContent } from "./humanize.js";
import { PDF_PER_RUN } from "./config.js";

export interface GeneratePdfsResult {
  drafted: number;
  routedBlogOnly: number;
}

// Humanizes research_docs content for every researched cluster and
// persists it to research_docs.humanized_content — regardless of whether
// a PDF ends up getting rendered, since lib/generateBlogPosts.ts now
// derives the companion post from this same humanized text (an excerpt
// for PDF'd clusters, the whole thing for blog_only ones) rather than
// generating its own separate content. One humanize call per cluster
// either way, just reused instead of duplicated.
//
// A cluster whose research doesn't meet meetsMinimumDepthForPdf
// (lib/pricing.ts) skips rendering a PDF and routes to status =
// 'blog_only' instead — confirmed live that thin research (e.g.
// ~250-300 words) produced a paid PDF barely more substantial than its
// own free companion post, a bad product regardless of how the blog copy
// was worded. 'blog_only' is a terminal status for that cluster: its blog
// post still goes through the normal draft/review/publish flow, it just
// never gets a pdfs row, a PDF review tap, or a Gumroad handoff — there's
// nothing paid to review or list.
export async function generatePdfsForResearchedClusters(supabase: SupabaseClient): Promise<GeneratePdfsResult> {
  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text")
    .eq("status", "researched")
    .order("score", { ascending: false })
    .limit(PDF_PER_RUN);

  if (error) throw new Error(`Failed to load researched clusters: ${error.message}`);
  if (!candidates || candidates.length === 0) return { drafted: 0, routedBlogOnly: 0 };

  let drafted = 0;
  let routedBlogOnly = 0;

  for (const cluster of candidates) {
    const { data: researchRows, error: researchErr } = await supabase
      .from("research_docs")
      .select("id, content")
      .eq("cluster_id", cluster.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (researchErr) {
      throw new Error(`Failed to load research for cluster ${cluster.id}: ${researchErr.message}`);
    }

    const researchDoc = researchRows?.[0];
    const content = researchDoc?.content as string | undefined;
    if (!researchDoc || !content) {
      throw new Error(`No research_docs content found for cluster ${cluster.id}`);
    }

    const title = cluster.representative_text as string;
    const humanized = await humanizeContent(content);

    const { error: humanizedUpdateErr } = await supabase
      .from("research_docs")
      .update({ humanized_content: humanized })
      .eq("id", researchDoc.id as string);
    if (humanizedUpdateErr) {
      throw new Error(`Failed to persist humanized content for cluster ${cluster.id}: ${humanizedUpdateErr.message}`);
    }

    if (!meetsMinimumDepthForPdf(content)) {
      const { error: updateErr } = await supabase
        .from("problem_clusters")
        .update({ status: "blog_only" })
        .eq("id", cluster.id);
      if (updateErr) throw new Error(`Failed to route cluster ${cluster.id} to blog_only: ${updateErr.message}`);
      routedBlogOnly++;
      continue;
    }

    const html = buildPdfHtml(title, humanized);
    const pdfBuffer = await renderPdf(html);
    const fileUrl = await uploadPdf(supabase, `${cluster.id}.pdf`, pdfBuffer);
    const price = computePrice(humanized);

    const { error: insertErr } = await supabase.from("pdfs").insert({
      cluster_id: cluster.id,
      file_url: fileUrl,
      title,
      price,
    });
    if (insertErr) throw new Error(`Failed to save PDF record for cluster ${cluster.id}: ${insertErr.message}`);

    const { error: updateErr } = await supabase
      .from("problem_clusters")
      .update({ status: "drafted" })
      .eq("id", cluster.id);
    if (updateErr) throw new Error(`Failed to update cluster ${cluster.id} status: ${updateErr.message}`);
    drafted++;
  }

  return { drafted, routedBlogOnly };
}
