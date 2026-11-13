import React from 'react';
export default function dynamic(loader){
 const source=String(loader);
 if(source.includes('CustomerContactLog'))return function CustomerContactBoundary(props){const [draft,setDraft]=React.useState('');return React.createElement('section',{'data-testid':'customer-contact-boundary','data-customer':props.customerId},React.createElement('label',null,'Anteckningsutkast',React.createElement('input',{value:draft,onChange:event=>setDraft(event.target.value)})),React.createElement('button',{type:'button',onClick:props.onAccessDenied},'Neka kontaktåtkomst'));};

 if(source.includes('DealTradeInPurchase'))return function TradePurchaseBoundary(props){window.fixture.tradePurchaseBusy=props.onBusyChange;window.fixture.tradePurchaseDenied=props.onAccessDenied;return null;};
 if(source.includes('DealFulfilment'))return function FulfilmentBoundary(props){window.fixture.fulfilmentBusy=props.onBusyChange;window.fixture.fulfilmentDenied=props.onAccessDenied;return null;};
 if(source.includes('DirectDealForm'))return function DirectDealBoundary(props){window.fixture.directBusy=props.onBusyChange;window.fixture.directDenied=props.onAccessDenied;window.fixture.directScope={companyId:props.companyId,dealId:props.dealId??null,demo:!!props.demo};return React.createElement('div',{'data-testid':'direct-deal-boundary'},'Direktavtalets komponentgräns');};
 if(source.includes('UploadedPdfSigning'))return function PdfBoundary(props){window.fixture.pdfBusy=props.onBusyChange;return React.createElement('div',{'data-testid':'uploaded-pdf-boundary'},'PDF-signeringens komponentgräns');};
 return function LazyUnrelated(props){if(Array.isArray(props.costs))window.fixture.calculationDenied=props.onDenied;return Array.isArray(props.costs)?React.createElement('div',{'data-testid':'calculation-consumer'},`Verifierade kostnadsposter: ${props.costs.length}`):null;};
}
