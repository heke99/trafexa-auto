import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AdvertisingCreditInvoicePanel} from '../../../src/components/advertising-credit-invoice-panel';
const root=createRoot(document.getElementById('root'));
window.mountCredit=props=>flushSync(()=>root.render(React.createElement(AdvertisingCreditInvoicePanel,props)));
