import { z } from 'zod';
export const documentKinds = ['all', 'offer', 'contract', 'invoice', 'credit'] as const;
export type DocumentKind = Exclude<typeof documentKinds[number], 'all'>;
export const hubInputSchema = z.object({ companyId: z.string().uuid(), query: z.string().trim().max(120).default(''), kind: z.enum(documentKinds).default('all'), cursor: z.record(z.string(), z.unknown()).nullable().default(null) }).strict();
export type HubInput = z.input<typeof hubInputSchema>;
export type HubRow = { id: string; kind: DocumentKind; title: string; createdAt: string; downloadId: string };
export type HubPage = { companyId: string; actorId: string; role: string; query: string; kind: typeof documentKinds[number]; rows: HubRow[]; nextCursor: Record<string, unknown> | null };
export type HubResult = { ok: true; page: HubPage } | { ok: false; code: 'access_denied' | 'invalid_input' | 'unavailable'; message: string };
const row = z.object({ id: z.string().uuid(), kind: z.enum(['offer','contract','invoice','credit']), title: z.string().min(1).max(300), createdAt: z.string().datetime({offset:true}), downloadId: z.string().uuid() }).strict();
const page = z.object({ companyId: z.string().uuid(), actorId: z.string().uuid(), role: z.enum(['owner','admin','finance']), query: z.string(), kind: z.enum(documentKinds), rows: z.array(row).max(25), nextCursor: z.record(z.string(),z.unknown()).nullable() }).strict();
export function parseHubPage(value: unknown, expected: {companyId:string; actorId:string;role:string;query:string;kind:string}): HubPage {
 const parsed=page.parse(value);
 for(const key of ['companyId','actorId','role','query','kind'] as const) if(parsed[key]!==expected[key]) throw Error('Document scope mismatch');
 if(new Set(parsed.rows.map(r=>`${r.kind}:${r.id}`)).size!==parsed.rows.length || parsed.rows.some(r=>expected.kind!=='all' && r.kind!==expected.kind)) throw Error('Invalid document rows');
 return parsed;
}
/** Only existing protected application handlers; never Storage URLs. */
export function documentDownloadHref(row: HubRow, companyId: string, evidence=false): string {
 const id=z.string().uuid().parse(row.downloadId), company=z.string().uuid().parse(companyId);
 if(row.kind==='offer')return `/api/documents/${id}/pdf`;
 if(row.kind==='contract')return `/api/contract-signings/${id}/${evidence?'evidence':'pdf'}?companyId=${company}`;
 return `/api/advertising/${row.kind==='invoice'?'issued':'credits'}/${id}/pdf`;
}
