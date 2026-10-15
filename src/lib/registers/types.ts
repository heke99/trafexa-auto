import type { Customer, Deal, InventoryItem } from '@/lib/data/workspace';

export type DealerRegisterKind = 'inventory' | 'customers' | 'deals';
export type DealerRegisterSort = 'recent' | 'price_asc' | 'price_desc';
export type DealerRegisterRole = 'owner' | 'admin' | 'sales' | 'finance' | 'viewer';
export type DealerRegisterDeal = Deal & { customer: Customer; stockItem: InventoryItem };
export type DealerRegisterRows = { inventory: InventoryItem; customers: Customer; deals: DealerRegisterDeal };
export type DealerRegisterInput = {
  kind: DealerRegisterKind;
  expectedCompanyId: string;
  query?: string;
  /** Inventory status, customer kind or deal status; defaults to all. */
  status?: string;
  sort?: DealerRegisterSort;
  /** Opaque server cursor. Reset when changing the query, filter, sort or actor. */
  cursor?: string | null;
};
export type DealerRegisterScope = { companyId: string; actorId: string; role: DealerRegisterRole };
export type DealerRegisterPage = {
  [K in DealerRegisterKind]: DealerRegisterScope & {
    kind: K; rows: DealerRegisterRows[K][];
    totalCount: number; filteredCount: number;
    /** Company-wide status/kind totals, independent of the search query. */
    counts: Record<string, number>; nextCursor: string | null;
  }
}[DealerRegisterKind];
export type DealerRegisterResult = { ok: true; page: DealerRegisterPage } | { ok: false; error: string };

export type DealOptionsKind = 'customers' | 'inventory';
export type DealOptionsInput = {
  kind: DealOptionsKind; expectedCompanyId: string; query?: string;
  cursor?: string | null; selectedId?: string | null;
};
export type DealOptionsPage = {
  [K in DealOptionsKind]: DealerRegisterScope & {
    kind: K; rows: DealerRegisterRows[K][];
    /** Selected own-company record, independent of search; stock must be available. */
    selected: DealerRegisterRows[K] | null;
    totalCount: number; filteredCount: number; nextCursor: string | null;
  }
}[DealOptionsKind];
export type DealOptionsResult = { ok: true; page: DealOptionsPage } | { ok: false; error: string };
