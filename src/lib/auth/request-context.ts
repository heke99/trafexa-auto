import 'server-only';
import {cache} from 'react';
import {createServerSupabaseClient} from '@/lib/supabase/server';
import {authAvailabilityRead,throwIfAuthUnavailable} from './availability';
/** Initial navigation proof only. Mutations and post-data verification remain fresh. */
export const getRequestAuthContext=cache(async()=>{
 const db=await createServerSupabaseClient();
 const {data,error}=await authAvailabilityRead(()=>db.auth.getUser());
 throwIfAuthUnavailable(error);
 if(error||!data?.user)return null;
 return {db,user:data.user};
});
