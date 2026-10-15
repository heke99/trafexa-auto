import {createHash} from 'node:crypto';
import {record} from './billing-validation.ts';
import {invoiceUuid,BILLING_TOKEN,issuanceText,issuanceSequence,parseAdvertisingInvoiceSeries,parseAdvertisingInvoiceSeriesConfiguration,parseAdvertisingIssuedInvoice} from './issuance-validation.ts';
import {formatIssuedInvoiceNumber,invoiceDateInStockholm,invoiceDueDate} from './issuance-format.ts';
import {isIssuedInvoiceTextSupported} from './issuance-font-coverage.ts';
import type {AdvertisingCreditInvoice,AdvertisingCreditInvoiceSnapshot,AdvertisingCreditPage,AdvertisingCreditPreview} from './credit-types';
function exact(r:Record<string,unknown>,keys:string[]){if(Object.keys(r).length!==keys.length||keys.some(k=>!(k in r)))throw Error('Invalid credit fields');}
function hash(v:unknown){if(typeof v!=='string'||!BILLING_TOKEN.test(v))throw Error('Invalid credit hash');return v;}
function canonical(v:unknown,h:unknown,max:number){if(typeof v!=='string'||v.length>max||createHash('sha256').update(v,'utf8').digest('hex')!==hash(h))throw Error('Invalid credit canonical');return v;}
function day(v:unknown):string{if(typeof v!=='string')throw Error('Invalid credit date');invoiceDueDate(v,1);return v;}
function instant(v:unknown):string{if(typeof v!=='string')throw Error('Invalid credit timestamp');invoiceDateInStockholm(v);return v;}
export function creditReason(v:unknown){const text=issuanceText(v,500);if(!isIssuedInvoiceTextSupported(text))throw Error('Unsupported credit reason');return text;}
function snapshot(value:unknown,companyId:string,originalId:string):AdvertisingCreditInvoiceSnapshot{
 const r=record(value);exact(r,['status','documentType','direction','currency','rendererVersion','companyId','originalInvoiceId','creditNumber','creditDate','sequence','reason','series','originalInvoice','lines','netTotalOre','vatTotalOre','grossTotalOre']);
 if(r.status!=='credited'||r.documentType!=='full_credit'||r.direction!=='credit'||r.currency!=='SEK'||r.rendererVersion!==1||r.companyId!==companyId||r.originalInvoiceId!==originalId)throw Error('Invalid credit scope');
 const originalInvoice=parseAdvertisingIssuedInvoice(r.originalInvoice,companyId,originalId),series=parseAdvertisingInvoiceSeriesConfiguration(r.series),sequence=issuanceSequence(r.sequence),creditDate=day(r.creditDate),creditNumber=formatIssuedInvoiceNumber(series.prefix,series.year,Number(sequence)),reason=creditReason(r.reason);
 if(r.creditNumber!==creditNumber||Number(creditDate.slice(0,4))!==series.year||BigInt(sequence)<BigInt(series.firstNumber)||series.sellerOrganisationNumber!==originalInvoice.snapshot.series.sellerOrganisationNumber||creditDate<originalInvoice.invoiceDate||creditNumber===originalInvoice.invoiceNumber||BigInt(originalInvoice.snapshot.grossTotalOre)===0n)throw Error('Invalid credit legal source');
 if(!Array.isArray(r.lines)||r.lines.length!==originalInvoice.snapshot.lines.length)throw Error('Invalid credit rows');
 for(let i=0;i<r.lines.length;i++){const line=record(r.lines[i]),original=originalInvoice.snapshot.lines[i];exact(line,Object.keys(original));if(Object.entries(original).some(([k,v])=>line[k]!==v))throw Error('Credit differs from original row');}
 for(const k of ['netTotalOre','vatTotalOre','grossTotalOre'] as const)if(r[k]!==originalInvoice.snapshot[k])throw Error('Credit differs from original total');
 return{status:'credited',documentType:'full_credit',direction:'credit',currency:'SEK',rendererVersion:1,companyId,originalInvoiceId:originalId,creditNumber,creditDate,sequence,reason,series,originalInvoice,lines:originalInvoice.snapshot.lines,netTotalOre:originalInvoice.snapshot.netTotalOre,vatTotalOre:originalInvoice.snapshot.vatTotalOre,grossTotalOre:originalInvoice.snapshot.grossTotalOre};
}
export function parseAdvertisingCreditInvoice(value:unknown,companyId:string,id:string):AdvertisingCreditInvoice{
 const r=record(value);exact(r,['id','companyId','originalInvoiceId','createdAt','creditNumber','creditDate','sourceHash','canonicalSnapshot','snapshot']);if(r.id!==id||r.companyId!==companyId)throw Error('Wrong credit scope');
 const originalInvoiceId=invoiceUuid(r.originalInvoiceId),canonicalSnapshot=canonical(r.canonicalSnapshot,r.sourceHash,65000000),saved=snapshot(r.snapshot,companyId,originalInvoiceId),proof=snapshot(JSON.parse(canonicalSnapshot),companyId,originalInvoiceId),createdAt=instant(r.createdAt);
 if(JSON.stringify(saved)!==JSON.stringify(proof)||r.creditNumber!==saved.creditNumber||r.creditDate!==saved.creditDate||invoiceDateInStockholm(createdAt)!==saved.creditDate||Date.parse(createdAt)<Date.parse(saved.originalInvoice.createdAt))throw Error('Invalid credit proof');
 return{id:invoiceUuid(id),companyId:invoiceUuid(companyId),originalInvoiceId,createdAt,creditNumber:saved.creditNumber,creditDate:saved.creditDate,sourceHash:hash(r.sourceHash),canonicalSnapshot,snapshot:saved};
}
function parsePreview(value:unknown,p:Pick<AdvertisingCreditPage,'companyId'|'originalInvoice'|'businessDate'>,series:NonNullable<AdvertisingCreditPage['series']>):AdvertisingCreditPreview{
 const r=record(value);exact(r,['creditNumber','sequence','creditDate','originalSourceHash','seriesReviewToken','reviewToken','canonicalSnapshot']);
 const sequence=issuanceSequence(r.sequence),creditNumber=formatIssuedInvoiceNumber(series.prefix,series.year,Number(sequence)),creditDate=day(r.creditDate);
 if(sequence!==series.nextNumber||r.creditNumber!==creditNumber||creditDate!==p.businessDate||r.originalSourceHash!==p.originalInvoice.sourceHash||r.seriesReviewToken!==series.reviewToken)throw Error('Invalid credit preview');
 const canonicalSnapshot=canonical(r.canonicalSnapshot,r.reviewToken,10000),c=record(JSON.parse(canonicalSnapshot)),expected={companyId:p.companyId,originalInvoiceId:p.originalInvoice.id,originalSourceHash:p.originalInvoice.sourceHash,seriesId:series.id,seriesReviewToken:series.reviewToken,sequence,creditNumber,creditDate};exact(c,Object.keys(expected));if(Object.entries(expected).some(([k,v])=>c[k]!==v))throw Error('Invalid credit review source');
 return{creditNumber,sequence,creditDate,originalSourceHash:p.originalInvoice.sourceHash,seriesReviewToken:series.reviewToken,reviewToken:hash(r.reviewToken),canonicalSnapshot};
}
export function parseAdvertisingCreditPage(value:unknown,companyId:string,originalInvoiceId:string,actorUserId:string,actorRole:AdvertisingCreditPage['actorRole']):AdvertisingCreditPage{
 const r=record(value);exact(r,['companyId','actorUserId','actorRole','businessDate','currentYear','originalInvoice','series','credit','preview','blockers','canConfigureSeries','canCredit']);if(r.companyId!==companyId||r.actorUserId!==actorUserId||r.actorRole!==actorRole||!['platform_admin','owner','admin','finance'].includes(actorRole))throw Error('Wrong credit page scope');
 const businessDate=day(r.businessDate),currentYear=Number(businessDate.slice(0,4)),originalInvoice=parseAdvertisingIssuedInvoice(r.originalInvoice,companyId,originalInvoiceId),series=r.series===null?null:parseAdvertisingInvoiceSeries(r.series),credit=r.credit===null?null:parseAdvertisingCreditInvoice(r.credit,companyId,invoiceUuid(record(r.credit).id));
 if(r.currentYear!==currentYear||series!==null&&(actorRole!=='platform_admin'||series.year!==currentYear||series.sellerOrganisationNumber!==originalInvoice.snapshot.series.sellerOrganisationNumber)||credit!==null&&(credit.originalInvoiceId!==originalInvoiceId||credit.snapshot.originalInvoice.sourceHash!==originalInvoice.sourceHash))throw Error('Wrong credit source');
 const blockers:string[]=[];if(credit)blockers.push('credit.exists');if(BigInt(originalInvoice.snapshot.grossTotalOre)===0n)blockers.push('credit.zeroAmount');if(actorRole==='platform_admin'){if(series===null)blockers.push('series.unconfigured');else if(BigInt(series.nextNumber)>999999999n)blockers.push('series.exhausted');}else blockers.push('credit.adminOnly');if(originalInvoice.invoiceDate>businessDate)blockers.push('credit.dateBeforeOriginal');
 const canConfigureSeries=actorRole==='platform_admin'&&series===null&&credit===null&&BigInt(originalInvoice.snapshot.grossTotalOre)>0n&&originalInvoice.invoiceDate<=businessDate;
 if(JSON.stringify(r.blockers)!==JSON.stringify(blockers)||r.canCredit!==(blockers.length===0)||r.canConfigureSeries!==canConfigureSeries)throw Error('Invalid credit privileges');
 const preview=blockers.length===0&&series!==null?parsePreview(r.preview,{companyId,originalInvoice,businessDate},series):null;if(preview===null&&r.preview!==null)throw Error('Unexpected credit preview');
 return{companyId,actorUserId,actorRole,businessDate,currentYear,originalInvoice,series,credit,preview,blockers,canConfigureSeries,canCredit:blockers.length===0};
}
