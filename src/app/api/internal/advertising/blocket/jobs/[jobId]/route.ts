import { createBlocketRuntime } from '@/lib/advertising/blocket-runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = createBlocketRuntime();
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) { return handler.job(request, (await params).jobId); }
