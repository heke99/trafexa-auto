import {createHash} from 'node:crypto';
import {correctionFixture,id} from '../advertising-corrections/fixture.mjs';
export {id};
export const requiredFields=['legalName','organisationNumber','invoiceEmail','addressLine1','postalCode','city','countryCode'];
export function invoiceFixture({incomplete=false,zero=false}={}){
 const {actorUserId,actorRole,...basis}=correctionFixture(zero?{amount:'9007199254740993'}:{});
 const fields={legalName:'Åberg & Söner Bil AB',organisationNumber:'5560000001',invoiceEmail:'invoice@example.invalid',addressLine1:'Fakturagatan 1',addressLine2:null,postalCode:'11122',city:'Örebro',countryCode:'SE',reference:'Ekonomi Ö-7'};
 const buyerProfile={version:2,fields,missingFields:[]};
 const sellerFields={...fields,legalName:'Trafexa Nordic AB',organisationNumber:'5568554884',invoiceEmail:'info@example.invalid',reference:null};
 if(incomplete){sellerFields.addressLine1=null;sellerFields.postalCode=null;sellerFields.city=null;sellerFields.countryCode=null;}
 const sellerProfile={version:1,fields:sellerFields,missingFields:requiredFields.filter(key=>sellerFields[key]===null)};
 const missingFields=[...buyerProfile.missingFields.map(k=>'buyer.'+k),...sellerProfile.missingFields.map(k=>'seller.'+k),'vatTreatment'];
 const snapshot={status:'draft',currency:'SEK',vatStatus:'unresolved',companyId:id(1),month:'2026-09',buyerProfile,sellerProfile,basis,missingFields};
 return resignInvoice({id:id(60),companyId:id(1),month:'2026-09',version:3,createdAt:'2026-10-15T09:00:00Z',sourceHash:'',canonicalSnapshot:'',snapshot});
}
export function resignInvoice(value){value.canonicalSnapshot=JSON.stringify(value.snapshot);value.sourceHash=createHash('sha256').update(value.canonicalSnapshot).digest('hex');return value;}
