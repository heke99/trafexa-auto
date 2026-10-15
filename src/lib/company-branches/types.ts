export type BranchRole = 'owner' | 'admin';
export type BranchStatus = 'active' | 'archived';
export type BranchFields = {
  code: string; name: string; addressLine1: string; postalCode: string; city: string;
  publicEmail: string | null; publicPhone: string | null;
};
export type CompanyBranch = { id: string; companyId: string; version: number; status: BranchStatus; fields: BranchFields; createdAt: string; updatedAt: string };
export type BranchScope = { companyId: string; actorUserId: string; actorRole: BranchRole };
export type BranchPage = BranchScope & { branches: CompanyBranch[]; nextPageKey: string | null; status: BranchStatus; legalName: string; organisationNumber: string };
export type BranchReceipt = { companyId: string; actorUserId: string; requestId: string; action: 'save' | 'status'; branch: CompanyBranch };
export type BranchCode = 'unauthenticated' | 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable';
export type BranchResult<T> = ({ ok: true } & T) | { ok: false; code: BranchCode; message: string };
export type ListBranchesInput = { companyId: string; status: BranchStatus; pageKey?: string | null; limit?: number };
export type SaveBranchInput = { companyId: string; branchId: string; expectedVersion: number; fields: BranchFields; acknowledged: true; requestId: string };
export type SetBranchStatusInput = { companyId: string; branchId: string; expectedVersion: number; status: BranchStatus; reason: string; acknowledged: true; requestId: string };
