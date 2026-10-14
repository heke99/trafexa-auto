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
