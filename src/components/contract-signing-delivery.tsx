'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import { CustomerEmailDelivery } from './customer-email-delivery';

type Props={companyId:string;dealId:string;signingId:string;userId:string;role:string;completed?:boolean;disabled?:boolean;onBusyChange?:(busy:boolean)=>void;onDenied?:(message:string)=>void};
export function ContractSigningDelivery(props:Props){return <SigningDelivery key={`${props.companyId}:${props.dealId}:${props.signingId}:${props.userId}:${props.role}`} {...props}/>;}
function SigningDelivery({signingId,completed=false,disabled=false,onBusyChange,onDenied,...props}:Props){
  const sources=useRef(new Set<string>()),callback=useRef(onBusyChange);callback.current=onBusyChange;
  const [held,setHeld]=useState<string[]>([]);
  const report=useCallback((source:string,value:boolean)=>{if(value)sources.current.add(source);else sources.current.delete(source);setHeld([...sources.current]);callback.current?.(sources.current.size>0);},[]);
  const invitationBusy=useCallback((value:boolean)=>report('invitation',value),[report]),completionBusy=useCallback((value:boolean)=>report('completion',value),[report]);
  useEffect(()=>()=>{sources.current.clear();callback.current?.(false);},[]);
  return <><CustomerEmailDelivery {...props} referenceId={signingId} kind="contract_invitation" disabled={disabled||held.some(source=>source!=='invitation')} onBusyChange={invitationBusy} onDenied={onDenied}/>{completed&&<CustomerEmailDelivery {...props} referenceId={signingId} kind="contract_completed" disabled={disabled||held.some(source=>source!=='completion')} onBusyChange={completionBusy} onDenied={onDenied}/>}</>;
}
