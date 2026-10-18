import {item,issuedInvoice,paymentPage} from '../advertising-receivables-ui/fixtures.mjs';

export function companyInvoiceFixtures(companyId,actorUserId){
 const row=item(1,{companyId,companyStatus:'active'}),invoice=issuedInvoice(row),month=row.month;
 const original=invoice.snapshot.assessment.snapshot.draft.snapshot;
 for(const profile of [original.buyerProfile,original.sellerProfile])Object.assign(profile,{version:1,missingFields:[]});
 const settings={version:1,reviewToken:'f'.repeat(64),fields:{vatTreatment:'se_standard_25',sellerVatRegistered:true,sellerVatNumber:'SE556855488401',paymentDays:15,paymentMethod:'bankgiro',paymentAccount:'9912346',reason:'Kontrollerat underlag'}};
 const basis={original:null,reductionTotalOre:'0',netTotalOre:'10000'};
 const draft={id:'10000000-0000-4000-8000-000000007001',companyId,month,version:1,sourceHash:'c'.repeat(64),createdAt:row.createdAt,missingFields:[],snapshot:{...original,basis,missingFields:[]}};
 const assessment={id:'10000000-0000-4000-8000-000000007002',companyId,month,version:1,sourceHash:'d'.repeat(64),createdAt:row.createdAt,snapshot:{calculationVersion:2,lines:[],netTotalOre:'10000',vatTotalOre:'2500',grossTotalOre:'12500',settings,draft:{...draft}}};
 invoice.snapshot.assessment=assessment;
 const scope={companyId,actorUserId,actorRole:'platform_admin',month};
 return{
  billing:{...scope,rates:[],items:[],count:0,unpricedCount:0,totalOre:'0',locked:null,coverage:'complete',trackingStartedAt:row.createdAt,periodEnd:'2026-10-01T00:00:00Z',ended:true,legacyPublishedJobs:0},
  invoicePage:{...scope,buyerProfile:original.buyerProfile,sellerProfile:original.sellerProfile,basis,canEditBuyer:true,canEditSeller:true,drafts:[draft],nextBeforeVersion:null},
  invoiceDraft:draft,
  financialPage:{...scope,draft,settings,calculationVersion:2,preview:null,assessments:[assessment],nextBeforeVersion:null},
  financialAssessment:assessment,
  issuancePage:{...scope,currentYear:2026,assessment,isOutdated:false,series:null,invoice:{...invoice,assessmentId:assessment.id,isSourceOutdated:false},preview:null,blockers:['invoice.exists'],canConfigureSeries:false,canIssue:false},
  issuedInvoice:invoice,
  paymentPage:{...paymentPage(row),actorUserId},
 };
}
