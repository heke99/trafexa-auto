'use client';

import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';

export function PublicMobileMenu() {
 const detailsRef=useRef<HTMLDetailsElement>(null);
 const summaryRef=useRef<HTMLElement>(null);
 const [open,setOpen]=useState(false);
 const closeMenu=()=>{
  if(detailsRef.current)detailsRef.current.open=false;
  setOpen(false);
 };
 useEffect(()=>{
  if(!open)return;
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key!=='Escape')return;
   event.preventDefault();
   if(detailsRef.current)detailsRef.current.open=false;
   setOpen(false);
   summaryRef.current?.focus();
  };
  document.addEventListener('keydown',onKeyDown);
  return ()=>document.removeEventListener('keydown',onKeyDown);
 },[open]);
 return <details className="mobile-nav" ref={detailsRef} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary ref={summaryRef} aria-label={open?'Stäng menyn':'Öppna menyn'} aria-expanded={open} aria-controls="public-mobile-navigation"><Menu size={22}/></summary>
  <nav id="public-mobile-navigation" aria-label="Mobil huvudmeny">
   <a href="#systemet" onClick={closeMenu}>Systemet</a>
   <a href="#finansiering" onClick={closeMenu}>Finansiering</a>
   <a href="#natverket" onClick={closeMenu}>Nätverket</a>
   <a href="#kontakt" onClick={closeMenu}>Kontakta oss</a>
  </nav>
 </details>;
}
