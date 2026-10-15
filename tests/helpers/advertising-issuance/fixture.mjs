import {createHash} from 'node:crypto';
import {financialAssessment,id} from '../advertising-financial/fixture.mjs';
import {invoiceDateInStockholm,invoiceDueDate,formatIssuedInvoiceNumber} from '../../../src/lib/advertising/issuance-format.ts';
export {id};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function issuedInvoiceFixture(prices=['4','4']){
 const assessment=financialAssessment(prices),configuration={id:id(80),sellerOrganisationNumber:'5568554884',year:2026,prefix:'FIXTURE',firstNumber:'1',sellerRegisteredSeat:'Stockholm'};
 const canonicalConfiguration=JSON.stringify(configuration),series={...configuration,configurationHash:digest(canonicalConfiguration),canonicalConfiguration};
 const sequence='1',invoiceNumber=formatIssuedInvoiceNumber(series.prefix,series.year,Number(sequence)),invoiceDate='2026-10-15',dueDate=invoiceDueDate(invoiceDate,assessment.snapshot.settings.fields.paymentDays);
 const sourceRows=assessment.snapshot.draft.snapshot.basis.original.items;
 const lines=assessment.snapshot.lines.map((row,index)=>({...row,quantity:1,serviceDate:invoiceDateInStockholm(sourceRows[index].publishedAt)}));
 const snapshot={status:'issued',currency:'SEK',rendererVersion:1,companyId:assessment.companyId,month:assessment.month,invoiceNumber,invoiceDate,dueDate,sequence,serviceDatesAcknowledged:true,series,assessment,lines,netTotalOre:assessment.snapshot.netTotalOre,vatTotalOre:assessment.snapshot.vatTotalOre,grossTotalOre:assessment.snapshot.grossTotalOre};
 return resignIssued({id:id(90),companyId:assessment.companyId,month:assessment.month,createdAt:'2026-10-15T09:04:00Z',invoiceNumber,invoiceDate,dueDate,snapshot});
}
export function resignIssued(value){value.canonicalSnapshot=JSON.stringify(value.snapshot);value.sourceHash=digest(value.canonicalSnapshot);return value;}
