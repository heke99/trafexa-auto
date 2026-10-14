export type CrmRole = 'owner' | 'admin' | 'sales' | 'finance' | 'viewer';
export type ContactKind = 'call' | 'email' | 'meeting' | 'note';
export type FollowUpStatus = 'none' | 'pending' | 'done' | 'cancelled';
export type Contact = { id: string; companyId: string; customerId: string; kind: ContactKind; contactOn: string; summary: string; followUpOn: string | null; followUpStatus: FollowUpStatus; version: number; createdAt: string; actorLabel: 'Du' | 'Kollega'; customerName?: string };
export type CustomerContact = Contact;
export type ContactPage = { companyId: string; businessDate: string; contacts: Contact[]; nextPageKey: string | null };
export type CrmResult<T> = ({ ok: true } & T) | { ok: false; code: 'unauthenticated' | 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable'; message: string };
