// Real finance component, isolated IO; no production accounts or financial records.
export async function getPlatformAdvertisingReceivablesAction(input) {
 window.fixture.receivablesCalls ??= [];
 window.fixture.receivablesCalls.push(input);
 const response = window.fixture.receivablesResponses?.shift();
 if (response?.hold) return await new Promise(resolve => { window.releaseReceivables = resolve; });
 if (response?.throw) throw new Error('Fixture unavailable read');
 return response ?? { ok: false, code: 'unavailable', message: 'Avstämningsöversikten kunde inte läsas in.' };
}
