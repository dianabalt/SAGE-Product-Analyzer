// web/lib/supabaseClient.ts
import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client that ALSO manages the auth cookie
 * so API routes (server) can see your session.
 */
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default supabase;
