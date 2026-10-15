import {createHash} from 'node:crypto';
import {issuedInvoiceFixture,issuedInvoiceFixtureV2,id} from '../advertising-issuance/fixture.mjs';
export {id};
export function resignCredit(value){value.canonicalSnapshot=JSON.stringify(value.snapshot);value.sourceHash=createHash('sha256').update(value.canonicalSnapshot).digest('hex');return value;}
export function creditInvoiceFixture(prices=['4','4']){return fromOriginal(issuedInvoiceFixture(prices));}
export async function creditInvoiceFixtureV2(prices=['14950','14950']){return fromOriginal(await issuedInvoiceFixtureV2(prices));}
function fromOriginal(originalInvoice){const{companyId}=originalInvoice,creditNumber='FIXTURE-2026-000002',creditDate='2026-10-15',snapshot={status:'credited',documentType:'full_credit',direction:'credit',currency:'SEK',rendererVersion:1,companyId,originalInvoiceId:originalInvoice.id,creditNumber,creditDate,sequence:'2',reason:'Felaktig debitering, hela originalfakturan krediteras.',series:originalInvoice.snapshot.series,originalInvoice,lines:structuredClone(originalInvoice.snapshot.lines),netTotalOre:originalInvoice.snapshot.netTotalOre,vatTotalOre:originalInvoice.snapshot.vatTotalOre,grossTotalOre:originalInvoice.snapshot.grossTotalOre};return resignCredit({id:id(91),companyId,originalInvoiceId:originalInvoice.id,createdAt:'2026-10-15T09:05:00Z',creditNumber,creditDate,snapshot});}
