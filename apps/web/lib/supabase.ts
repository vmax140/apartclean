import { createClient } from '@supabase/supabase-js';
import type { Database } from '@apartclean/shared';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient<Database>(url, key, {
  auth: { flowType: 'pkce', detectSessionInUrl: false },
}) : undefined;
