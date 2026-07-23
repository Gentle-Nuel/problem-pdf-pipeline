import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.js";

// Service-role client for use in cron/API functions only — never expose
// SUPABASE_SERVICE_ROLE_KEY to a client-facing context.
export function getSupabaseClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
}
