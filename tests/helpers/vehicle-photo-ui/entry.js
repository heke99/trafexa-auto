import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {VehiclePhotoGallery} from '../../../src/components/vehicle-photo-gallery';
const root=createRoot(document.getElementById('root'));
window.mountPhotos=props=>flushSync(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(VehiclePhotoGallery,{...props,onBusyChange:value=>window.fixture.busy.push(value),onAccessDenied:message=>window.fixture.denials.push(message),onPhotosChange:photos=>window.fixture.changes.push(photos)}))));
window.fetch=async(url,options)=>{
 const form=options.body,file=form.get('file');
 const request={companyId:form.get('companyId'),stockId:form.get('stockId'),photoId:form.get('photoId'),requestId:form.get('requestId'),file:{name:file.name,type:file.type,size:file.size,bytes:[...new Uint8Array(await file.arrayBuffer())]}};
 const f=window.fixture;f.uploads.push(request);
 let result=f.uploadResponses.shift();
 if(result?.throw)throw Error('Unknown upload');
 if(result?.hold)result=await new Promise(resolve=>{f.releaseUpload=resolve;});
 if(!result){const photo={...f.base,id:request.photoId,companyId:request.companyId,stockId:request.stockId};f.photos.push(photo);result={ok:true,photo};}
 return {ok:result.ok===true,json:async()=>result};
};
