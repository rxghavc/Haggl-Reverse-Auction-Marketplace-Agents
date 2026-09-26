import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Prefer classic JWT service_role key (bypasses RLS).
 * Falls back to newer SUPABASE_SECRET_KEY (sb_secret_…).
 * Never use anon / publishable for backend writes.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_PROJECT_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_PROJECT_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY"
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
