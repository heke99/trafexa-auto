import React from 'react';
export default function dynamic(loader){
 const source=String(loader);
 if(source.includes('DirectDealForm'))return function DirectDealBoundary(props){window.fixture.directBusy=props.onBusyChange;window.fixture.directDenied=props.onAccessDenied;window.fixture.directScope={companyId:props.companyId,dealId:props.dealId??null,demo:!!props.demo};return React.createElement('div',{'data-testid':'direct-deal-boundary'},'Direktavtalets komponentgräns');};
 if(source.includes('UploadedPdfSigning'))return function PdfBoundary(props){window.fixture.pdfBusy=props.onBusyChange;return React.createElement('div',{'data-testid':'uploaded-pdf-boundary'},'PDF-signeringens komponentgräns');};
 return function LazyUnrelated(props){if(Array.isArray(props.costs))window.fixture.calculationDenied=props.onDenied;return Array.isArray(props.costs)?React.createElement('div',{'data-testid':'calculation-consumer'},`Verifierade kostnadsposter: ${props.costs.length}`):null;};
}
