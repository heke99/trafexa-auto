import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CompanyPublicStore} from '../../../src/components/company-public-store';
const root=createRoot(document.getElementById('root'));
window.mountPublicStore=props=>flushSync(()=>root.render(React.createElement(CompanyPublicStore,props)));
