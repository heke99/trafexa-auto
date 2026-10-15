import {createHash} from 'node:crypto';
export const id=n=>`bd360000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function billingFixture(){
 const items=[{publicationId:id(3),listingId:id(4),channel:'blocket',publishedAt:'2026-09-12T09:00:00Z',unitPriceOre:'9007199254740993',priceSource:'rate',rateVersion:1},{publicationId:id(5),listingId:id(4),channel:'wayke',publishedAt:'2026-09-13T09:00:00Z',unitPriceOre:'0',priceSource:'review',rateVersion:null}];
 const snapshot={companyId:id(1),month:'2026-09',periodStart:'2026-08-31T22:00:00Z',periodEnd:'2026-09-30T22:00:00Z',trackingStartedAt:'2026-09-10T09:00:00Z',coverage:'partial',items,count:2,unpricedCount:0,totalOre:'9007199254740993',legacyPublishedJobs:3};
 const canonicalSnapshot=JSON.stringify(snapshot,null,2),reviewToken=createHash('sha256').update(canonicalSnapshot).digest('hex');
 return{...snapshot,actorUserId:id(2),actorRole:'finance',ended:true,rates:[],reviewToken,hasChangesSinceLock:false,locked:{...snapshot,id:id(6),lockedAt:'2026-10-01T09:00:00Z',reviewToken,canonicalSnapshot,partialCoverageAcknowledged:true}};
}
