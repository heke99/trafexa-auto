export async function listVehiclePhotosAction(input){
 const f=window.fixture;f.reads.push(input);const result=f.readResponses.shift();
 if(result?.throw)throw Error('Read unavailable');
 if(result?.hold)return new Promise(resolve=>{f.releaseRead=resolve;});
 return result??{ok:true,photos:f.photos,nextPageKey:null};
}
export async function archiveVehiclePhotoAction(input){
 const f=window.fixture;f.archives.push(input);let result=f.archiveResponses.shift();
 if(result?.throw)throw Error('Archive unknown');
 if(result?.hold)return new Promise(resolve=>{f.releaseArchive=resolve;});
 if(result)return result;
 const photo={...f.photos.find(p=>p.id===input.photoId),status:'archived',version:input.expectedVersion+1};f.photos=f.photos.filter(p=>p.id!==input.photoId);return {ok:true,photo};
}
