export function loadDealerRegisterPage(input) { return window.fixture.read('register', input); }
export function searchDealOptions(input) { return window.fixture.read('options', input); }
export function loadVehicleCostPage(input) { return window.fixture.read('costs', input); }
export function createDealAction(form) { return window.fixture.mutate('createDeal', Object.fromEntries(form)); }
export function createVehicleCostAction(form) { return window.fixture.mutate('createCost', Object.fromEntries(form)); }
export function loadVehicleCosts(input){return window.fixture.read('costs',input);}
export function createVehicleAction(form){return window.fixture.mutate('createVehicle',Object.fromEntries(form));}
export function createCustomerAction(form){return window.fixture.mutate('createCustomer',Object.fromEntries(form));}
export function reserveVehicleAction(form){return window.fixture.mutate('reserveVehicle',Object.fromEntries(form));}
export function createFinanceRequestAction(form){return window.fixture.mutate('createFinanceRequest',Object.fromEntries(form));}
export function releaseReservationAction(form){return window.fixture.mutate('releaseReservation',Object.fromEntries(form));}
export function updateVehiclePriceAction(form){return window.fixture.mutate('updateVehiclePrice',Object.fromEntries(form));}
export function signOutAction(form){return window.fixture.mutate('signOut',Object.fromEntries(form));}
export function selectCompanyAction(form){return window.fixture.mutate('selectCompany',Object.fromEntries(form));}
