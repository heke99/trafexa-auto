import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidSignatureCanvas, isCanvasBlocked, MAX_SIGNATURE_STROKES, MAX_SIGNATURE_POINTS_PER_STROKE, MAX_SIGNATURE_POINTS, MAX_SIGNATURE_COORDINATE } from '../src/lib/signing/docuseal-ported/signature-validation.ts';
const stroke = points => ({ points: points.map(([x,y]) => ({x,y})) });
const straight = stroke([[0,0],[3,0],[6,0]]), curve = stroke([[0,0],[3,9],[6,0]]);
test('ported deviation threshold and first-two-straight-strokes rule preserve actual upstream behavior',()=>{
  assert.equal(isValidSignatureCanvas([]),false);assert.equal(isValidSignatureCanvas([stroke([[0,0],[3,9]])]),false);
  assert.equal(isValidSignatureCanvas([straight]),false);assert.equal(isValidSignatureCanvas([straight,straight]),false);
  assert.equal(isValidSignatureCanvas([straight,straight,straight]),true);
  assert.equal(isValidSignatureCanvas([curve]),true);assert.equal(isValidSignatureCanvas([stroke([[0,0],[3,8.99],[6,0]])]),false);
  assert.equal(isValidSignatureCanvas([straight,curve]),true);
});
test('repeated identical clicks reject upstream NaN bug while an actual closed loop remains valid',()=>{
  const click=stroke([[4,4],[4,4],[4,4]]);
  assert.equal(isValidSignatureCanvas([click]),false);assert.equal(isValidSignatureCanvas([click,click,click]),false);
  assert.equal(isValidSignatureCanvas([stroke([[0,0],[6,0],[6,6],[0,0]])]),true);
  assert.equal(isValidSignatureCanvas([stroke([[0,0],[1,0],[1,1],[0,0]])]),false);
});
test('untrusted stroke shapes, non-finite/out-of-range coordinates and contaminated valid input fail closed',()=>{
  for(const value of [null,{},'stroke',[null],[{}],[{points:null}],[{points:[null,null,null]}]])assert.equal(isValidSignatureCanvas(value),false);
  for(const value of [NaN,Infinity,-Infinity,'3',null,MAX_SIGNATURE_COORDINATE+1])assert.equal(isValidSignatureCanvas([curve,{points:[{x:value,y:0},{x:1,y:1},{x:2,y:2}]}]),false);
  const boundary=stroke([[MAX_SIGNATURE_COORDINATE-6,MAX_SIGNATURE_COORDINATE-9],[MAX_SIGNATURE_COORDINATE-3,MAX_SIGNATURE_COORDINATE],[MAX_SIGNATURE_COORDINATE,MAX_SIGNATURE_COORDINATE-9]]);
  assert.equal(isValidSignatureCanvas([boundary]),true);
  assert.equal(isValidSignatureCanvas([{points:curve.points,color:'red',providerState:'completed'}]),true);
});
test('stroke/per-stroke/aggregate bounds cap processing and no drawing data is mutated',()=>{
  assert.equal(isValidSignatureCanvas(Array(MAX_SIGNATURE_STROKES+1).fill(straight)),false);
  assert.equal(isValidSignatureCanvas([{points:Array(MAX_SIGNATURE_POINTS_PER_STROKE+1).fill({x:1,y:1})}]),false);
  const full={points:Array(MAX_SIGNATURE_POINTS_PER_STROKE).fill({x:1,y:1})};
  assert.equal(isValidSignatureCanvas([full,full,full,full,{points:[{x:1,y:1}]}]),false);assert.equal(MAX_SIGNATURE_POINTS,MAX_SIGNATURE_POINTS_PER_STROKE*4);
  const input=[structuredClone(curve)],copy=structuredClone(input);assert.equal(isValidSignatureCanvas(input),true);assert.deepEqual(input,copy);
  input[Symbol.iterator]=()=>{throw Error('Untrusted iteration must not execute');};assert.equal(isValidSignatureCanvas(input),true);
  assert.equal(isValidSignatureCanvas([{get points(){throw Error('untrusted getter');}}]),false);
});
function documentFixture({blocked=false,noContext=false,throws=false}={}){
  const events=[];const ctx={fillStyle:'',fillRect(...args){events.push(['fill',...args]);},getImageData(...args){events.push(['read',...args]);if(throws)throw Error('canvas access blocked');return{data:new Uint8ClampedArray(blocked?[0,0,0,0]:[255,0,0,255])};}};
  const canvas={width:0,height:0,getContext(type){assert.equal(type,'2d');return noContext?null:ctx;}};
  return{doc:{createElement(tag){assert.equal(tag,'canvas');return canvas;}},canvas,ctx,events};
}
test('actual canvas pixel probe recognizes normal and privacy-blocked canvas with no DOM access during SSR import',()=>{
  assert.equal(typeof globalThis.document,'undefined');assert.equal(isCanvasBlocked(),true);
  const good=documentFixture();assert.equal(isCanvasBlocked(good.doc),false);assert.equal(good.canvas.width,2);assert.equal(good.canvas.height,2);assert.equal(good.ctx.fillStyle,'rgb(255, 0, 0)');assert.deepEqual(good.events,[['fill',0,0,2,2],['read',0,0,1,1]]);
  for(const config of [{blocked:true},{noContext:true},{throws:true}])assert.equal(isCanvasBlocked(documentFixture(config).doc),true);
  assert.equal(isCanvasBlocked({createElement(){throw Error('No canvas');}}),true);
});
