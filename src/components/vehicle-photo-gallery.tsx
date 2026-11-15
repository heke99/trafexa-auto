'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { archiveVehiclePhotoAction, listVehiclePhotosAction } from '@/lib/vehicle-photos/actions';
import { MAX_PHOTO_BYTES, type VehiclePhoto } from '@/lib/vehicle-photos/types';

type Props={companyId:string;stockId:string;userId?:string;canEdit?:boolean;demo?:boolean;onPhotosChange?:(photos:VehiclePhoto[])=>void;onBusyChange?:(busy:boolean)=>void;onAccessDenied?:(message:string)=>void};
export function VehiclePhotoGallery(props:Props){return <PhotoPanel key={`${props.companyId}:${props.stockId}:${props.userId}:${!!props.canEdit}:${!!props.demo}`} {...props}/>;}
function PhotoPanel({ companyId, stockId, canEdit = false, demo = false, onPhotosChange, onBusyChange, onAccessDenied }:Props) {
  const [photos, setPhotos] = useState<VehiclePhoto[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<VehiclePhoto | null>(null);
  const [denied, setDenied] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0),alive=useRef(true),locked=useRef(false),uncertain=useRef<'upload'|'archive'|null>(null),busyCallback=useRef(onBusyChange);busyCallback.current=onBusyChange;
  const [unknown,setUnknown]=useState<'upload'|'archive'|null>(null);
  function report(value:boolean){busyCallback.current?.(value);}
  function markUnknown(value:'upload'|'archive'|null){uncertain.current=value;setUnknown(value);}
  const callback = useRef(onPhotosChange);
  const input = useRef<HTMLInputElement>(null);
  const uploadIntent = useRef<{ file: File; photoId: string; requestId: string } | null>(null);
  const archiveIntent = useRef<{ photoId: string; version: number; requestId: string } | null>(null);
  useEffect(() => { callback.current = onPhotosChange; }, [onPhotosChange]);

  function clear() { setPhotos([]); callback.current?.([]); }
  function failed(result: { code?: string; message: string }) {
    clear(); setError(result.message);
    if (result.code === 'access_denied') { markUnknown(null);setDenied(true); setReview(null);setFile(null);uploadIntent.current=null;archiveIntent.current=null;if(input.current)input.current.value='';onAccessDenied?.(result.message);report(false); }
  }
  async function read(requestGeneration: number) {
    const result = await listVehiclePhotosAction({ companyId, stockId });
    if (!alive.current||generation.current !== requestGeneration) return;
    if (!result.ok) { failed(result); return; }
    if(!Array.isArray(result.photos)||result.photos.some(photo=>photo.companyId!==companyId||photo.stockId!==stockId||photo.status!=='active')){failed({code:'access_denied',message:'Bildernas företag och lagerbil kunde inte verifieras.'});return;}
    setPhotos(result.photos); callback.current?.(result.photos);
  }
  function load() {
    if (demo || denied || pending || locked.current || uncertain.current) return;
    const requestGeneration = ++generation.current; setError(null);
    startTransition(async () => { try { await read(requestGeneration); } catch { if (generation.current === requestGeneration) failed({ message: 'Bilderna kunde inte verifieras. Läs in dem igen.' }); } });
  }
  useEffect(() => {
    alive.current=true;const requestGeneration = ++generation.current;
    clear(); setError(null); setDenied(false); setReview(null); setFile(null); uploadIntent.current = null;
    if (!demo) startTransition(async () => { try { await read(requestGeneration); } catch { if (generation.current === requestGeneration) failed({ message: 'Bilderna kunde inte verifieras. Läs in dem igen.' }); } });
    return () => { alive.current=false;++generation.current;report(false); };
  }, [companyId, stockId, demo]);

  function upload() {
    if ((!file&&!uploadIntent.current) || !canEdit || demo || denied || pending || locked.current || uncertain.current==='archive') return;
    const selectedFile=uncertain.current==='upload'?uploadIntent.current?.file:file;if(!selectedFile)return;
    if (selectedFile.size < 1 || selectedFile.size > MAX_PHOTO_BYTES || !['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type)) { setError('Välj en JPEG-, PNG- eller WebP-bild på högst 10 MiB.'); return; }
    if (uploadIntent.current?.file !== selectedFile) uploadIntent.current = { file:selectedFile, photoId: crypto.randomUUID(), requestId: crypto.randomUUID() };
    const intent = uploadIntent.current, requestGeneration = ++generation.current;
    locked.current=true;report(true);setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const form = new FormData(); form.set('companyId', companyId); form.set('stockId', stockId); form.set('photoId', intent.photoId); form.set('requestId', intent.requestId); form.set('file', intent.file);
        const response = await fetch('/api/vehicle-photos', { method: 'POST', body: form, credentials: 'same-origin' });
        const result = await response.json();
        if (!alive.current||generation.current !== requestGeneration) return;
        if (!response.ok || result.ok !== true) { markUnknown(['invalid_input','conflict','access_denied'].includes(result.code)?null:'upload');if(!uncertain.current)uploadIntent.current=null;failed({ code: result.code, message: typeof result.message === 'string' ? result.message : 'Bilden kunde inte sparas. Försök igen med samma fil.' }); return; }
        if (result.photo?.id !== intent.photoId || result.photo?.companyId !== companyId || result.photo?.stockId !== stockId || result.photo?.status !== 'active') throw new Error();
        markUnknown(null);setFile(null); if (input.current) input.current.value = ''; uploadIntent.current = null;
        setMessage('Bilden har sparats privat. Du väljer vilka bilder som ska ingå i annonsen.');
        try{await read(requestGeneration);}catch{if(alive.current&&generation.current===requestGeneration)failed({message:'Bilden är sparad men bildlistan kunde inte läsas in. Läs in bilderna igen.'});}
      } catch { if (alive.current&&generation.current === requestGeneration){markUnknown('upload');failed({ message: 'Svaret kunde inte verifieras. Kontrollera samma bilduppladdning innan du lämnar bilen.' });} }
      finally{locked.current=false;if(alive.current&&generation.current===requestGeneration)report(uncertain.current!==null);}
    });
  }
  function archive() {
    if (!review || !canEdit || demo || denied || pending || locked.current || uncertain.current==='upload') return;
    if (archiveIntent.current?.photoId !== review.id || archiveIntent.current.version !== review.version) archiveIntent.current = { photoId: review.id, version: review.version, requestId: crypto.randomUUID() };
    const intent = archiveIntent.current, requestGeneration = ++generation.current;
    locked.current=true;report(true);setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const result = await archiveVehiclePhotoAction({ companyId, photoId: intent.photoId, expectedVersion: intent.version, requestId: intent.requestId });
        if (!alive.current||generation.current !== requestGeneration) return;
        if (!result.ok) {markUnknown(result.code==='unavailable'?'archive':null);if(!uncertain.current){setReview(null);archiveIntent.current=null;}failed(result);return;}
        if(result.photo.id!==intent.photoId||result.photo.companyId!==companyId||result.photo.stockId!==stockId||result.photo.status!=='archived'||result.photo.version!==intent.version+1)throw Error('invalid photo receipt');
        markUnknown(null);setReview(null); archiveIntent.current = null; setMessage('Bilden har tagits bort från nya bildval. Sparade annonsversioner behåller sitt underlag.');
        try{await read(requestGeneration);}catch{if(alive.current&&generation.current===requestGeneration)failed({message:'Borttagningen är sparad men bildlistan kunde inte läsas in. Läs in bilderna igen.'});}
      } catch { if (alive.current&&generation.current === requestGeneration){markUnknown('archive');failed({ message: 'Ändringen kunde inte verifieras. Kontrollera samma borttagning innan du lämnar bilen.' });} }
      finally{locked.current=false;if(alive.current&&generation.current===requestGeneration)report(uncertain.current!==null);}
    });
  }
  return <section className="surface" style={{ marginBlock: 24 }} aria-label="Bilens annonsbilder">
    <div className="panel-heading"><h2>Annonsbilder</h2>{!demo && <button type="button" className="text-link" disabled={pending || denied || unknown!==null} onClick={load}>Läs in bilder</button>}</div>
    <p className="settings-note">Bilderna är privata i företaget. JPEG, PNG och WebP, högst 10 MiB per bild och 20 bilder per bil. Bildmetadata tas bort vid uppladdning.</p>
    {demo && <p className="quiet-empty">Bildhantering visas i företagets inloggade arbetsyta.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}{pending && <p role="status">Verifierar bilder…</p>}
    {!demo && !denied && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 16, padding: 20 }}>{photos.map(photo => <figure key={photo.id} style={{ margin: 0 }}><img src={`/api/vehicle-photos/${photo.id}`} alt="Fordonsbild i företagets privata arkiv" width={280} height={180} style={{ width: '100%', height: 180, objectFit: 'contain' }}/><figcaption>{photo.contentType === 'image/jpeg' ? 'JPEG' : photo.contentType === 'image/png' ? 'PNG' : 'WebP'} · {Math.ceil(photo.sizeBytes / 1024)} KiB{canEdit && <button type="button" className="text-link" disabled={pending||unknown!==null} onClick={() => { setReview(photo); setError(null); }}>Ta bort bild</button>}</figcaption></figure>)}</div>}
    {!demo && !denied && !pending && !unknown && !photos.length && <p className="quiet-empty">Inga annonsbilder har sparats på bilen.</p>}
    {!demo && !denied && canEdit && <form className="workspace-form" style={{ padding: 20 }} onSubmit={event => { event.preventDefault(); upload(); }}><label>Välj fordonsbild<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={pending || unknown!==null || photos.length >= 20} onChange={event => { if(locked.current||uncertain.current)return;setFile(event.target.files?.[0] ?? null); uploadIntent.current = null; setError(null); }}/></label><button type="submit" className="button button-green" disabled={pending || unknown==='archive' || !file || (unknown!=='upload'&&photos.length >= 20)}>{unknown==='upload'?'Kontrollera samma bilduppladdning':'Spara bild privat'}</button></form>}
    {review && !denied && <div className="dialog-content"><h3>Ta bort bilden från nya annonser?</h3><p>Bilden försvinner från nya bildval. Tidigare annonsversioners underlag bevaras.</p><div className="table-controls"><button type="button" className="button button-green" disabled={pending} onClick={archive}>Bekräfta borttagning</button><button type="button" className="text-link" disabled={pending||unknown!==null} onClick={() => setReview(null)}>Avbryt</button></div></div>}
  </section>;
}
