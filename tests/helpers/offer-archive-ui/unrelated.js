import React from 'react';
export default function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); }
export function StockImport() { return null; }
export function CustomerLeads() { return null; }

export function CompanyTeam() { return null; }
export function VehicleCalculation() { return null; }
export function VehiclePhotoGallery() { return null; }
export function AdvertisingWorkspace() { return null; }
export function CustomerContactLog(props) { if(!window.fixture?.crmOutside)return null;return React.createElement('section',{'aria-label':'Kontaktfixture','data-company':props.companyId,'data-customer':props.customerId,'data-can-edit':String(props.canEdit)},React.createElement('button',{type:'button',onClick:props.onAccessDenied},'Neka kontaktåtkomst')); }
export function CompanyFollowups(props) { if(!window.fixture?.crmOutside)return null;return React.createElement('button',{type:'button',onClick:()=>props.onSelectCustomer(window.fixture.crmOutside)},'Öppna kund utanför tabellurvalet'); }

export function DealerOfferReviews() { return null; }

export function useRouter() { return {refresh(){window.fixture.refreshCalls=(window.fixture.refreshCalls??0)+1;}}; }
export function DealCancellation(props) { return React.createElement('span',{'data-cancellation':props.dealId,'data-company':props.companyId,'data-edit':String(props.canEdit),'data-demo':String(!!props.demo)},props.status); }

export function DealTradeIns(props) { return React.createElement('span',{'data-trade-in':props.dealId,'data-company':props.companyId,'data-edit':String(props.canEdit),'data-demo':String(!!props.demo)},'Inbytesfixture'); }
