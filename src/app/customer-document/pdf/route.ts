import {downloadGuestCustomerDocument} from '@/lib/documents/guest-customer-download';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return downloadGuestCustomerDocument(request,'pdf');}
