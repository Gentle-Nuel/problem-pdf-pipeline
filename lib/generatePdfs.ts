import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPdfHtml } from "./pdfTemplate.js";
import { renderPdf } from "./pdf.js";
import { uploadPdf } from "./storage.js";
import { computePrice } from "./pricing.js";
import { PDF_PER_RUN } from "./config.js";

// Renders a PDF for each researched-but-undrafted cluster, uploads it to
// Supabase Storage, records it in pdfs, and advances status to 'drafted'.
export async function generatePdfsForResearchedClusters(supabase: SupabaseClient): Promise<number> {
  const { data: candidates, error } = await supabase
    .from("problem_clusters")
    .select("id, representative_text")
    .eq("status", "researched")
    .order("score", { ascending: false })
    .limit(PDF_PER_RUN);

  if (error) throw new Error(`Failed to load researched clusters: ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  for (const cluster of candidates) {
    const { data: researchRows, error: researchErr } = await supabase
      .from("research_docs")
      .select("content")
      .eq("cluster_id", cluster.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (researchErr) {
      throw new Error(`Failed to load research for cluster ${cluster.id}: ${researchErr.message}`);
    }

    const content = researchRows?.[0]?.content as string | undefined;
    if (!content) {
      throw new Error(`No research_docs content found for cluster ${cluster.id}`);
    }

    const title = cluster.representative_text as string;
    const html = buildPdfHtml(title, content);
    const pdfBuffer = await renderPdf(html);
    const fileUrl = await uploadPdf(supabase, `${cluster.id}.pdf`, pdfBuffer);
    const price = computePrice(content);

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
  }

  return candidates.length;
}
