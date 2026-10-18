'use client';

import {useCallback,useEffect,useRef,useState} from 'react';

/** Keep enclosing navigation mounted while a nested financial request is in flight. */
export function useDescendantBusy(onBusyChange?: (busy:boolean)=>void) {
 const [busy,setBusy]=useState(false);
 const current=useRef(false),active=useRef(true),callback=useRef(onBusyChange);
 callback.current=onBusyChange;
 useEffect(()=>{active.current=true;return()=>{active.current=false;if(current.current){current.current=false;callback.current?.(false);}};},[]);
 const report=useCallback((value:boolean)=>{if(!active.current||current.current===value)return;current.current=value;setBusy(value);callback.current?.(value);},[]);
 return {busy,busyRef:current,report};
}
