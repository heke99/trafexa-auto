export type VehicleCostCreateInput = {
  companyId: string; requestId: string; stockItemId: string;
  category: 'repair' | 'transport' | 'inspection' | 'finance' | 'other';
  description: string; amount: string; incurredOn: string;
};
export type VehicleCostCreateReceipt = {
  companyId: string; actorId: string; requestId: string; kind: 'vehicle_cost'; recordId: string;
  stockItemId: string; category: VehicleCostCreateInput['category']; description: string;
  amountOre: string; incurredOn: string; createdAt: string;
};
export type VehicleCostCreateResult = { ok: true; receipt: VehicleCostCreateReceipt } | {
  ok: false; code: 'invalid_input' | 'access_denied' | 'conflict' | 'unavailable'; message: string;
};
