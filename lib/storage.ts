import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "pdfs";

// Creates the storage bucket on first use rather than requiring a manual
// dashboard step — one less piece of setup instructions to hand off.
export async function uploadPdf(supabase: SupabaseClient, fileName: string, pdfBuffer: Buffer): Promise<string> {
  const attempt = () =>
    supabase.storage.from(BUCKET).upload(fileName, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  let { error } = await attempt();

  if (error && /bucket not found/i.test(error.message)) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (createErr && !/already exists/i.test(createErr.message)) {
      throw new Error(`Failed to create storage bucket: ${createErr.message}`);
    }
    ({ error } = await attempt());
  }

  if (error) throw new Error(`Failed to upload PDF: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}
