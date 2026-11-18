import 'server-only';
import { assertSupabaseEnvironment } from '@/lib/runtime/environment';
import type { Database } from './database.types';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabaseClient() {
 const store = await cookies();
 const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if (!url || !key) throw new Error('Supabase is not configured');
 assertSupabaseEnvironment(url);
 return createServerClient<Database>(url,key,{cookies:{
  getAll:()=>store.getAll(),
  setAll(items){try {items.forEach(({name,value,options})=>store.set(name,value,options));} catch { /* Server component cookies are refreshed by proxy. */ }}
 }});
}
export const createClient = createServerSupabaseClient;
