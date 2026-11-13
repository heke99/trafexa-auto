async function call(action,value){const r=await fetch(['refreshUploadedPdfGuestAction','signUploadedPdfGuestAction'].includes(action)?'/pdf-document/__action':'/__action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,value})});return r.json();}
export const listUploadedPdfAction=value=>call('listUploadedPdfAction',value);
export const requestUploadedPdfAction=value=>call('requestUploadedPdfAction',value);
export const cancelUploadedPdfAction=value=>call('cancelUploadedPdfAction',value);
export const retryUploadedPdfMailAction=value=>call('retryUploadedPdfMailAction',value);
export const refreshUploadedPdfGuestAction=value=>call('refreshUploadedPdfGuestAction',value);
export const signUploadedPdfGuestAction=value=>call('signUploadedPdfGuestAction',value);
