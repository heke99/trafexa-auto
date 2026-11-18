'use client';
import { assertSupabaseEnvironment } from '@/lib/runtime/environment';
import type { Database } from './database.types';
import { createBrowserClient } from '@supabase/ssr';
export function createClient() {
 assertSupabaseEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL, typeof window === 'undefined' ? undefined : window.location.origin);
 return createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
