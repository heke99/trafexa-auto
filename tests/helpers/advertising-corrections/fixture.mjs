import {createHash} from 'node:crypto';
import {billingFixture,id} from '../advertising-billing/fixture.mjs';
export {id};
export function correctionFixture({amount='993',reason='Överenskommen prisnedsättning',empty=false}={}) {
  const billing=billingFixture(),original=billing.locked;
  const adjustments=empty?[]:[{id:id(30),publicationId:id(3),amountOre:amount,reason,createdAt:'2026-10-02T09:00:00Z',createdBy:'Superadmin'}];
  const reductionTotalOre=adjustments.reduce((sum,row)=>sum+BigInt(row.amountOre),0n).toString();
  const netTotalOre=(BigInt(original.totalOre)-BigInt(reductionTotalOre)).toString();
  const snapshot={companyId:billing.companyId,month:billing.month,originalId:original.id,originalReviewToken:original.reviewToken,adjustments,reductionTotalOre,netTotalOre};
  const canonicalSnapshot=JSON.stringify(snapshot),reviewToken=createHash('sha256').update(canonicalSnapshot).digest('hex');
  return {companyId:billing.companyId,actorUserId:billing.actorUserId,actorRole:billing.actorRole,month:billing.month,
    original,adjustments,reductionTotalOre,netTotalOre,canonicalSnapshot,reviewToken};
}
