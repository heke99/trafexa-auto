async function call(action,value){const r=await fetch('/__pdf_action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,value})});return r.json();}
export const listPdfTemplateVersionsAction=value=>call('list',value);
export const savePdfTemplateVersionAction=value=>call('save',value);
export const generatePdfTemplateSourceAction=value=>call('generate',value);
