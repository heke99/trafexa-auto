import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AdvertisingIssuedInvoicePanel} from '../../../src/components/advertising-issued-invoice-panel';
const root=createRoot(document.getElementById('root'));
window.mountIssuance=props=>flushSync(()=>root.render(React.createElement(AdvertisingIssuedInvoicePanel,props)));
