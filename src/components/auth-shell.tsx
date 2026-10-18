import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Brand } from './brand';

export function AuthShell({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  return <main className="auth-page"><aside className="auth-panel"><Brand light/><div><p className="eyebrow">För den oberoende bilhandlaren</p><h2>Hela bilaffären.<br/>På en plats.</h2><p>Från bilen som kommer in till nycklarna som lämnas över. Lager, kunder och affärer i ett sammanhängande flöde.</p><Link href="/demo" className="text-link" style={{marginTop:30}}>Se systemet med exempeldata <ArrowUpRight size={16}/></Link></div><small>Trafexa · Byggd för din bilaffär.</small></aside><section className="auth-card" style={{minWidth:0,overflowWrap:'anywhere'}}>{title?<h1>{title}</h1>:null}{subtitle?<p>{subtitle}</p>:null}{children}</section></main>;
}
