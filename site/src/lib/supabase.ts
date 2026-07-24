import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — set these in this site's own Vercel project env vars (separate project from the main pipeline, see README step 8b).",
  );
}

// Build-time only — this file must never be imported from client-side
// code. For a fully static site (Astro's default output mode) this runs
// during `astro build`, never in the browser, so using the service role
// key here (rather than a public anon key + RLS policy) is safe.
export const supabase = createClient(url, key);
