import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CustomerLeads} from '../../../src/components/customer-leads';
const root=createRoot(document.getElementById('root'));
window.mountLeads=props=>flushSync(()=>root.render(React.createElement(CustomerLeads,props)));
