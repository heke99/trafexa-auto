'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { archiveVehiclePhotoAction, listVehiclePhotosAction } from '@/lib/vehicle-photos/actions';
import { MAX_PHOTO_BYTES, type VehiclePhoto } from '@/lib/vehicle-photos/types';

export function VehiclePhotoGallery({ companyId, stockId, canEdit = false, demo = false, onPhotosChange }: { companyId: string; stockId: string; canEdit?: boolean; demo?: boolean; onPhotosChange?: (photos: VehiclePhoto[]) => void }) {
  const [photos, setPhotos] = useState<VehiclePhoto[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<VehiclePhoto | null>(null);
  const [denied, setDenied] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const callback = useRef(onPhotosChange);
  const input = useRef<HTMLInputElement>(null);
  const uploadIntent = useRef<{ file: File; photoId: string; requestId: string } | null>(null);
  const archiveIntent = useRef<{ photoId: string; version: number; requestId: string } | null>(null);
  useEffect(() => { callback.current = onPhotosChange; }, [onPhotosChange]);

  function clear() { setPhotos([]); callback.current?.([]); }
  function failed(result: { code?: string; message: string }) {
    clear(); setError(result.message);
    if (result.code === 'access_denied') { setDenied(true); setReview(null); }
  }
  async function read(requestGeneration: number) {
    const result = await listVehiclePhotosAction({ companyId, stockId });
    if (generation.current !== requestGeneration) return;
    if (!result.ok) { failed(result); return; }
    setPhotos(result.photos); callback.current?.(result.photos);
  }
  function load() {
    if (demo || denied || pending) return;
    const requestGeneration = ++generation.current; setError(null);
    startTransition(async () => { try { await read(requestGeneration); } catch { if (generation.current === requestGeneration) failed({ message: 'Bilderna kunde inte verifieras. Läs in dem igen.' }); } });
  }
  useEffect(() => {
    const requestGeneration = ++generation.current;
    clear(); setError(null); setDenied(false); setReview(null); setFile(null); uploadIntent.current = null;
    if (!demo) startTransition(async () => { try { await read(requestGeneration); } catch { if (generation.current === requestGeneration) failed({ message: 'Bilderna kunde inte verifieras. Läs in dem igen.' }); } });
    return () => { ++generation.current; };
  }, [companyId, stockId, demo]);

  function upload() {
    if (!file || !canEdit || demo || denied || pending) return;
    if (file.size < 1 || file.size > MAX_PHOTO_BYTES || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Välj en JPEG-, PNG- eller WebP-bild på högst 10 MiB.'); return; }
    if (uploadIntent.current?.file !== file) uploadIntent.current = { file, photoId: crypto.randomUUID(), requestId: crypto.randomUUID() };
    const intent = uploadIntent.current, requestGeneration = ++generation.current;
    setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const form = new FormData(); form.set('companyId', companyId); form.set('stockId', stockId); form.set('photoId', intent.photoId); form.set('requestId', intent.requestId); form.set('file', file);
        const response = await fetch('/api/vehicle-photos', { method: 'POST', body: form, credentials: 'same-origin' });
        const result = await response.json();
        if (generation.current !== requestGeneration) return;
        if (!response.ok || result.ok !== true) { failed({ code: result.code, message: typeof result.message === 'string' ? result.message : 'Bilden kunde inte sparas. Försök igen med samma fil.' }); return; }
        if (result.photo?.id !== intent.photoId || result.photo?.companyId !== companyId || result.photo?.stockId !== stockId || result.photo?.status !== 'active') throw new Error();
        setFile(null); if (input.current) input.current.value = ''; uploadIntent.current = null;
        setMessage('Bilden har sparats privat. Du väljer vilka bilder som ska ingå i annonsen.');
        await read(requestGeneration);
      } catch { if (generation.current === requestGeneration) failed({ message: 'Svaret kunde inte verifieras. Försök igen med samma fil.' }); }
    });
  }
  function archive() {
    if (!review || !canEdit || demo || denied || pending) return;
    if (archiveIntent.current?.photoId !== review.id || archiveIntent.current.version !== review.version) archiveIntent.current = { photoId: review.id, version: review.version, requestId: crypto.randomUUID() };
    const intent = archiveIntent.current, requestGeneration = ++generation.current;
    setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const result = await archiveVehiclePhotoAction({ companyId, photoId: intent.photoId, expectedVersion: intent.version, requestId: intent.requestId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { failed(result); return; }
        setReview(null); archiveIntent.current = null; setMessage('Bilden har tagits bort från nya bildval. Sparade annonsversioner behåller sitt underlag.');
        await read(requestGeneration);
      } catch { if (generation.current === requestGeneration) failed({ message: 'Ändringen kunde inte verifieras. Försök igen med samma begäran.' }); }
    });
  }
  return <section className="surface" style={{ marginBlock: 24 }} aria-label="Bilens annonsbilder">
    <div className="panel-heading"><h2>Annonsbilder</h2>{!demo && <button type="button" className="text-link" disabled={pending || denied} onClick={load}>Läs in bilder</button>}</div>
    <p className="settings-note">Bilderna är privata i företaget. JPEG, PNG och WebP, högst 10 MiB per bild och 20 bilder per bil. Bildmetadata tas bort vid uppladdning.</p>
    {demo && <p className="quiet-empty">Bildhantering visas i företagets inloggade arbetsyta.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}{pending && <p role="status">Verifierar bilder…</p>}
    {!demo && !denied && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 16, padding: 20 }}>{photos.map(photo => <figure key={photo.id} style={{ margin: 0 }}><img src={`/api/vehicle-photos/${photo.id}`} alt="Fordonsbild i företagets privata arkiv" width={280} height={180} style={{ width: '100%', height: 180, objectFit: 'contain' }}/><figcaption>{photo.contentType === 'image/jpeg' ? 'JPEG' : photo.contentType === 'image/png' ? 'PNG' : 'WebP'} · {Math.ceil(photo.sizeBytes / 1024)} KiB{canEdit && <button type="button" className="text-link" disabled={pending} onClick={() => { setReview(photo); setError(null); }}>Ta bort bild</button>}</figcaption></figure>)}</div>}
    {!demo && !denied && !pending && !photos.length && <p className="quiet-empty">Inga annonsbilder har sparats på bilen.</p>}
    {!demo && !denied && canEdit && <form className="workspace-form" style={{ padding: 20 }} onSubmit={event => { event.preventDefault(); upload(); }}><label>Välj fordonsbild<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={pending || photos.length >= 20} onChange={event => { setFile(event.target.files?.[0] ?? null); uploadIntent.current = null; setError(null); }}/></label><button type="submit" className="button button-green" disabled={pending || !file || photos.length >= 20}>Spara bild privat</button></form>}
    {review && !denied && <div className="dialog-content"><h3>Ta bort bilden från nya annonser?</h3><p>Bilden försvinner från nya bildval. Tidigare annonsversioners underlag bevaras.</p><div className="table-controls"><button type="button" className="button button-green" disabled={pending} onClick={archive}>Bekräfta borttagning</button><button type="button" className="text-link" disabled={pending} onClick={() => setReview(null)}>Avbryt</button></div></div>}
  </section>;
}
