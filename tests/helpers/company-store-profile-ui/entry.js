import React from 'react';
import {createRoot} from 'react-dom/client';
import {CompanyStoreProfile} from '../../../src/components/company-store-profile';
import {CompanyOnboarding} from '../../../src/components/company-onboarding';
const root=createRoot(document.getElementById('root'));
window.mountStore=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(CompanyStoreProfile,props)));
window.mountOnboarding=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(CompanyOnboarding,props)));
