'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { isCanvasBlocked, isValidSignatureCanvas, MAX_SIGNATURE_POINTS, MAX_SIGNATURE_POINTS_PER_STROKE, MAX_SIGNATURE_STROKES, type SignaturePoint, type SignatureStroke } from '@/lib/signing/docuseal-ported/signature-validation';

/** Drawing is only input. The caller binds it to the reviewed server document and consent. */
export function ContractSignatureInput({ disabled=false, onChange }: { disabled?: boolean; onChange: (strokes: SignatureStroke[] | null) => void }) {
  const instructions=useId(),canvas=useRef<HTMLCanvasElement>(null), strokes=useRef<SignatureStroke[]>([]), pointer=useRef<number|null>(null), callback=useRef(onChange),keyboardPen=useRef(false),cursor=useRef<SignaturePoint>({x:300,y:80});
  const [blocked,setBlocked]=useState(false),[message,setMessage]=useState('Rita din namnteckning med mus, penna, finger eller tangentbord.'),[focused,setFocused]=useState(false),[position,setPosition]=useState(cursor.current),[penDown,setPenDown]=useState(false);
  callback.current=onChange;
  useEffect(()=>{try{setBlocked(isCanvasBlocked()||!canvas.current?.getContext('2d'));}catch{setBlocked(true);}return()=>{strokes.current=[];pointer.current=null;keyboardPen.current=false;};},[]);
  useEffect(()=>{if(disabled){keyboardPen.current=false;pointer.current=null;setPenDown(false);}},[disabled]);
  function point(event:PointerEvent<HTMLCanvasElement>){const rect=event.currentTarget.getBoundingClientRect();if(!rect.width||!rect.height||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return null;return {x:Math.max(0,Math.min(600,(event.clientX-rect.left)*600/rect.width)),y:Math.max(0,Math.min(160,(event.clientY-rect.top)*160/rect.height))};}
  function begin(p:SignaturePoint){if(strokes.current.length>=MAX_SIGNATURE_STROKES||strokes.current.reduce((n,s)=>n+s.points.length,0)>=MAX_SIGNATURE_POINTS)return false;strokes.current.push({points:[{...p}]});callback.current(null);const ctx=canvas.current?.getContext('2d');ctx?.beginPath();ctx?.moveTo(p.x,p.y);setMessage('Namnteckningen ritas…');return true;}
  function append(p:SignaturePoint){const stroke=strokes.current.at(-1);if(!stroke||stroke.points.length>=MAX_SIGNATURE_POINTS_PER_STROKE||strokes.current.reduce((n,s)=>n+s.points.length,0)>=MAX_SIGNATURE_POINTS)return;const last=stroke.points.at(-1);if(last?.x===p.x&&last.y===p.y)return;stroke.points.push({...p});const ctx=canvas.current?.getContext('2d');if(ctx){ctx.strokeStyle='#183d2f';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineTo(p.x,p.y);ctx.stroke();}}
  function publish(){const valid=isValidSignatureCanvas(strokes.current);callback.current(valid?strokes.current.map(stroke=>({points:stroke.points.map(p=>({...p}))})):null);setMessage(valid?'Namnteckningen är klar att granskas.':'Rita en längre, varierad namnteckning innan du fortsätter.');}
  function finishKeyboard(){if(!keyboardPen.current)return;keyboardPen.current=false;setPenDown(false);publish();}
  function down(event:PointerEvent<HTMLCanvasElement>){if(disabled||blocked||pointer.current!==null||event.button!==0)return;const p=point(event);if(!p)return;finishKeyboard();if(!begin(p))return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);pointer.current=event.pointerId;}
  function move(event:PointerEvent<HTMLCanvasElement>){if(disabled||event.pointerId!==pointer.current)return;const p=point(event);if(p)append(p);}
  function finish(event:PointerEvent<HTMLCanvasElement>){if(event.pointerId!==pointer.current)return;pointer.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(!disabled)publish();}
  function key(event:KeyboardEvent<HTMLCanvasElement>){
    if(disabled||blocked||pointer.current!==null||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.key===' '||event.key==='Enter'){
      event.preventDefault();if(event.repeat)return;
      if(keyboardPen.current)finishKeyboard();else if(begin(cursor.current)){keyboardPen.current=true;setPenDown(true);setMessage('Pennan är nere. Rita med piltangenterna. Tryck mellanslag eller Enter för att lyfta pennan.');}return;
    }
    if(event.key==='Escape'&&keyboardPen.current){event.preventDefault();event.stopPropagation();finishKeyboard();return;}
    const direction=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[event.key];if(!direction)return;
    event.preventDefault();const step=event.shiftKey?2:8,next={x:Math.max(0,Math.min(600,cursor.current.x+direction[0]*step)),y:Math.max(0,Math.min(160,cursor.current.y+direction[1]*step))};cursor.current=next;setPosition(next);if(keyboardPen.current)append(next);
  }
  function clear(){if(disabled)return;canvas.current?.getContext('2d')?.clearRect(0,0,600,160);strokes.current=[];pointer.current=null;keyboardPen.current=false;setPenDown(false);callback.current(null);setMessage('Namnteckningen är rensad.');}
  return <section aria-label="Din namnteckning" style={{display:'grid',gap:10,minWidth:0}}>{blocked?<p role="alert">Namnteckningsfältet fungerar inte i den här webbläsaren. Prova en annan webbläsare.</p>:<>
    <p id={instructions} className="muted">Med tangentbord: gå till ritfältet med Tab. Flytta markören med piltangenterna. Tryck mellanslag eller Enter för att sänka eller lyfta pennan. Håll Skift för mindre steg. Escape lyfter pennan och Tab går vidare.</p>
    <div style={{position:'relative',width:'100%',maxWidth:600}}><canvas ref={canvas} width={600} height={160} role="img" aria-label="Rita din namnteckning" aria-describedby={instructions} aria-disabled={disabled} tabIndex={disabled?-1:0} style={{display:'block',width:'100%',height:160,border:'1px solid #b7c7bc',borderRadius:8,background:'#fff',touchAction:'none',outline:focused?'3px solid #183d2f':undefined,outlineOffset:focused?3:undefined}} onFocus={()=>setFocused(true)} onBlur={()=>{setFocused(false);if(!disabled)finishKeyboard();}} onKeyDown={key} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}/>{focused&&!disabled?<span aria-hidden="true" style={{position:'absolute',pointerEvents:'none',left:`${position.x/6}%`,top:`${position.y/1.6}%`,width:12,height:12,boxSizing:'border-box',border:'2px solid #183d2f',background:penDown?'#183d2f':'#fff',borderRadius:'50%',transform:'translate(-50%,-50%)'}}/>:null}</div>
    {focused&&!disabled?<p className="small muted">Tangentbordsmarkör: {position.x}, {position.y}. Pennan är {penDown?'nere':'uppe'}.</p>:null}<p role="status">{message}</p><button type="button" className="button button-outline" disabled={disabled} onClick={clear}>Rensa namnteckning</button></>}</section>;
}
