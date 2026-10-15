import { createBlocketRuntime } from '@/lib/advertising/blocket-runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = createBlocketRuntime();
export async function POST(request: Request) { return handler.readiness(request); }
