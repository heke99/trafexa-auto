'use client';

import Link from 'next/link';
import {ArrowRight} from 'lucide-react';
import type {WorkspaceSnapshot} from '@/lib/data/workspace';
import {canManageStockIntake} from '@/lib/access/dealer-capabilities';

type Props={snapshot:WorkspaceSnapshot;demo?:boolean};
/** Suggest only tasks available to the current dealer role; no setup status is inferred from partial registers. */
export function DealerGettingStarted({snapshot,demo=false}:Props){
 const role=snapshot.membership?.role??'viewer';
 const route=(section:string)=>demo?`/demo?section=${section}`:`/${section}`;
 const steps=canManageStockIntake(role)?[
  {href:'settings#settings-store',title:'Kontrollera butiksinformationen',text:'Kontaktuppgifter och företagets information inför annonsering.'},
  {href:'inventory',title:'Registrera bilar i lagret',text:'Fordonsuppgifter, inköpsunderlag och försäljningspris.'},
  {href:'customers',title:'Samla kunder och skapa affärer',text:'Registrera kunden och koppla ihop kund och bil i Affärer.'},
 ]:role==='sales'?[
  {href:'inventory',title:'Arbeta med lagrets bilar',text:'Kontrollera försäljningspriser, bilder och tillgängliga bilar.'},
  {href:'customers',title:'Registrera dina kunder',text:'Spara kontaktuppgifter inför nästa affär.'},
  {href:'deals',title:'Skapa och följ affärer',text:'Välj kund och bil, skapa offert och hantera reservationer.'},
 ]:role==='finance'?[
  {href:'deals',title:'Granska affärernas underlag',text:'Kontrollera offerter, avtal och inköpsunderlag.'},
  {href:'inventory',title:'Följ inköpsvärden och kalkyler',text:'Granska lagerbilarnas interna ekonomiska underlag.'},
  {href:'finance',title:'Anmäl finansbehov',text:'Registrera företagets behov hos Trafexa för uppföljning.'},
 ]:[
  {href:'inventory',title:'Se tillgängliga bilar',text:'Läs fordonsuppgifter och försäljningspriser.'},
  {href:'customers',title:'Hitta kunduppgifter',text:'Sök efter kunder i företagets register.'},
  {href:'deals',title:'Följ pågående affärer',text:'Läs status och uppgifter. Kontakta en ansvarig för ändringar.'},
 ];
 return <section className="surface next-step-panel" aria-label="Nästa steg för din roll"><div className="panel-heading"><h2>{role==='viewer'?'Hitta i arbetsytan':'Nästa steg'}</h2></div>{steps.map((step,index)=><div className="setup-step" key={step.href}><span className="step-circle">{index+1}</span><div><Link href={route(step.href)}>{step.title} <ArrowRight size={14}/></Link><p>{step.text}</p></div></div>)}{demo?<p className="settings-note">Demonstrationen är i läsläge. Alla uppgifter är fiktiva.</p>:null}</section>;
}
