'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { loadDealerDocumentHub } from '@/lib/document-hub/actions';
import { documentDownloadHref, documentKinds, type HubPage } from '@/lib/document-hub/types';
const labels={all:'Alla dokument',offer:'Offerter',contract:'Signerade avtal',invoice:'Fakturor',credit:'Kreditfakturor'};
export function DealerDocumentHub(props:{companyId:string;userId:string;role:string;demo:boolean}){
 // Scope changes unmount all buffered metadata, filters and in-flight results.
 return <DocumentScope key={`${props.companyId}:${props.userId}:${props.role}:${props.demo}`} {...props}/>;
}
function DocumentScope({companyId,userId,role,demo}:{companyId:string;userId:string;role:string;demo:boolean}){
 const [query,setQuery]=useState(''),[kind,setKind]=useState<typeof documentKinds[number]>('all'),[page,setPage]=useState<HubPage|null>(null),[error,setError]=useState(''),[pending,startTransition]=useTransition();
 const sequence=useRef(0),live=useRef(true);
 const allowed=['owner','admin','finance'].includes(role);
 function load(cursor:Record<string,unknown>|null=null){const ticket=++sequence.current;setPage(null);setError('');startTransition(async()=>{try{const result=await loadDealerDocumentHub({companyId,query:query.trim(),kind,cursor});if(!live.current||ticket!==sequence.current)return;if(!result.ok){setError(result.message);return;}if(result.page.companyId!==companyId||result.page.actorId!==userId||result.page.role!==role){setError('Dokumentens företagsbehörighet kunde inte verifieras.');return;}setPage(result.page);}catch{if(live.current&&ticket===sequence.current)setError('Dokumentöversikten kunde inte hämtas. Försök igen.');}});}
 useEffect(()=>{live.current=true;if(allowed&&!demo)load();return()=>{live.current=false;sequence.current++;};},[]); // Scope is remounted by the wrapper.
 if(!allowed)return <p>Offerter, signerade avtal och ekonomidokument visas för ägare, administratör och finansansvarig.</p>;
 if(demo)return <p>Dokumentöversikten är tillgänglig i ett anslutet företagskonto. Inga privata dokument hämtas i demoläget.</p>;
 return <section aria-label="Samlad dokumentöversikt"><p>Arkiverade offerter, lagrade avtalsoriginal med signeringsbevis samt utfärdade annonsfakturor och kreditfakturor. Pågående avtal hanteras i affären.</p>
 <form onSubmit={event=>{event.preventDefault();load();}} style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end'}}><label>Sök dokument<input value={query} maxLength={120} onChange={event=>{sequence.current++;setPage(null);setError('');setQuery(event.target.value);}} placeholder="Namn eller dokumentnummer"/></label><label>Dokumenttyp<select value={kind} onChange={event=>{sequence.current++;setPage(null);setError('');setKind(event.target.value as typeof kind);}}>{documentKinds.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label><button className="button button-outline" disabled={pending}>Sök</button><button type="button" className="button button-outline" onClick={()=>load()} disabled={pending}>Uppdatera</button></form>
 {pending&&<p role="status">Hämtar dokument…</p>}{error&&<p role="alert">{error}</p>}{page&&<><p role="status">{page.rows.length?`${page.rows.length} dokument på sidan`:'Inga dokument matchar filtret.'}</p><ul style={{listStyle:'none',padding:0}}>{page.rows.map(row=><li key={`${row.kind}:${row.id}`} style={{padding:'14px 0',borderBottom:'1px solid var(--border)',overflowWrap:'anywhere'}}><strong>{row.title}</strong><p>{labels[row.kind]} · {new Date(row.createdAt).toLocaleDateString('sv-SE')}</p><a className="text-link" href={documentDownloadHref(row,companyId)}>Hämta PDF: {row.title}</a>{row.kind==='contract'&&<> · <a className="text-link" href={documentDownloadHref(row,companyId,true)}>Hämta signeringsbevis</a></>}</li>)}</ul>{page.nextCursor&&<button type="button" className="button button-outline" disabled={pending} onClick={()=>load(page.nextCursor)}>Nästa sida</button>}<button type="button" className="button button-outline" disabled={pending} onClick={()=>load()}>Första sidan</button></>}
 </section>;
}
