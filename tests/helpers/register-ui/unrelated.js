import React from 'react';
export const CompanyTeam=()=>null;
export const VehicleCalculation=({costs})=>React.createElement('div',{'data-testid':'calculation-consumer'},`Verifierade kostnadsposter: ${costs.length}`);
export const PurchaseCondition=()=>null;
export const ContractTemplateWorkspace=()=>null;
export const DealContracts=()=>null;
export const VehiclePhotoGallery=()=>null;
export const AdvertisingWorkspace=()=>null;
export const CustomerContactLog=()=>null;
export const CompanyFollowups=()=>null;
export const DealCancellation=props=>{window.fixture.cancelBusy=props.onBusyChange;window.fixture.cancelCompleted=props.onCancelled;return React.createElement('div',{'data-testid':'cancellation-boundary'},'Avbrytningens komponentgräns');};
export const DealTradeIns=props=>{window.fixture.tradeUnderlayBusy=props.onBusyChange;window.fixture.tradeUnderlayDenied=props.onAccessDenied;return null;};
export const StockImport=props=>{window.fixture.importBusy=props.onBusyChange;window.fixture.importCompleted=props.onCompleted;window.fixture.importDenied=props.onAccessDenied;return React.createElement('div',{'data-testid':'import-boundary'});};
export const DealOffers=props=>{window.fixture.offerBusy=props.onBusyChange;window.fixture.offerDenied=props.onAccessDenied;return null;};
export const CustomerLeads=()=>null;
export default function Unrelated(){return null;}

export const DealTradeInPurchase=()=>null;

export const CompanyStoreProfile=()=>null;

export const CompanyBranches=()=>null;

export const CompanyPublicStore=()=>null;
export const DealFulfilment=()=>null;
export const DealerNetwork=()=>null;
export const DealerDocumentHub=()=>null;

export const DirectDealForm=()=>null;
export const UploadedPdfSigning=()=>null;

export const PaperSaleForm=()=>null;export const PdfTemplateWorkspace=()=>null;export const DealArchiveControl=()=>null;
