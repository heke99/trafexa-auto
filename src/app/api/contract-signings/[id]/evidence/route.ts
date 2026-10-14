import { downloadSignedContract } from '@/lib/documents/signed-contract-download';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return downloadSignedContract(request,(await params).id,'evidence');}
