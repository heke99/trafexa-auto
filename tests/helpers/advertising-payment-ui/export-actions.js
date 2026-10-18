async function exportFile(input,platform){window.paymentCalls.push({kind:'export',platform,...structuredClone(input)});const next=window.paymentExports.shift();if(next?.hold)return new Promise((resolve,reject)=>window.releasePaymentExport={resolve,reject});if(next?.throw)throw Error('Export unavailable');return next??{ok:true,export:structuredClone(window.paymentExport)};}
export const getPlatformAdvertisingPaymentExportAction=input=>exportFile(input,true);
export const getAdvertisingPaymentExportAction=input=>exportFile(input,false);
