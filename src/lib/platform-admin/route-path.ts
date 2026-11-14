import 'server-only';
import {headers} from 'next/headers';
import {isPlatformAdminPath,safeNextPath} from '@/lib/routing.mjs';

/** Return navigation only: never use request metadata to grant access. */
export async function platformAdminReturnPath():Promise<string>{
  try{
    const candidate=(await headers()).get('x-trafexa-admin-path');
    const path=safeNextPath(candidate??'/admin');
    return isPlatformAdminPath(path.split('?')[0])?path:'/admin';
  }catch{return '/admin';}
}
