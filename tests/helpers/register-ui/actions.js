export function loadDealerRegisterPage(input) { return window.fixture.read('register', input); }
export function searchDealOptions(input) { return window.fixture.read('options', input); }
export function loadVehicleCostPage(input) { return window.fixture.read('costs', input); }
export function createDealAction(form) { return window.fixture.mutate('createDeal', Object.fromEntries(form)); }
export function createVehicleCostAction(form) { return window.fixture.mutate('createCost', Object.fromEntries(form)); }
export async function createVehicleCostRequestAction(input) { const result=await window.fixture.mutate('createCost',input); if(result!==undefined)return result; const [whole,fraction='']=input.amount.replace(',','.').split('.'); return {ok:true,receipt:{companyId:input.companyId,actorId:window.fixture.scope.actorId,requestId:input.requestId,kind:'vehicle_cost',recordId:'90000000-0000-4000-8000-000000000001',stockItemId:input.stockItemId,category:input.category,description:input.description,amountOre:(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))).toString(),incurredOn:input.incurredOn,createdAt:'2026-11-12T12:00:00Z'}}; }
export function loadVehicleCosts(input){return window.fixture.read('costs',input);}
export function createVehicleAction(form){return window.fixture.mutate('createVehicle',Object.fromEntries(form));}
export function createCustomerAction(form){return window.fixture.mutate('createCustomer',Object.fromEntries(form));}
export function reserveVehicleAction(form){return window.fixture.mutate('reserveVehicle',Object.fromEntries(form));}
export function createFinanceRequestAction(form){return window.fixture.mutate('createFinanceRequest',Object.fromEntries(form));}
export function releaseReservationAction(form){return window.fixture.mutate('releaseReservation',Object.fromEntries(form));}
export function updateVehiclePriceAction(form){return window.fixture.mutate('updateVehiclePrice',Object.fromEntries(form));}
export function signOutAction(form){return window.fixture.mutate('signOut',Object.fromEntries(form));}
export function selectCompanyAction(form){return window.fixture.mutate('selectCompany',Object.fromEntries(form));}
