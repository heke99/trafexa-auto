export async function getCustomerDocumentRenewalAction(){return{ok:false,code:'unavailable',message:'Dokumentlänkens status ingår inte i denna testvy.'};}
export async function renewCustomerDocumentAction(){throw Error('Unexpected document-link renewal in unrelated UI harness');}
