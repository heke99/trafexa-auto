import React from 'react';
import {createRoot} from 'react-dom/client';
import {CompanyStoreProfile} from '../../../src/components/company-store-profile';
import {CompanyOnboarding} from '../../../src/components/company-onboarding';
const root=createRoot(document.getElementById('root'));
window.mountStore=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(CompanyStoreProfile, {...props,onBusyChange:value=>(window.fixture.busyEvents??=[]).push(value),onAccessDenied:message=>(window.fixture.denials??=[]).push(message),onChanged:()=>window.fixture.changed=(window.fixture.changed??0)+1})));
window.mountOnboarding=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(CompanyOnboarding,props)));
