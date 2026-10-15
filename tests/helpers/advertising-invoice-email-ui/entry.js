import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AdvertisingInvoiceEmailPanel} from '../../../src/components/advertising-invoice-email-panel';
const root=createRoot(document.getElementById('root'));
window.mountInvoiceEmail=props=>flushSync(()=>root.render(React.createElement(AdvertisingInvoiceEmailPanel,{...props,onDenied:message=>{window.emailDenials??=[];window.emailDenials.push(message);}})));
