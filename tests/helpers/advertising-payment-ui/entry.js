import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AdvertisingPaymentPanel} from '../../../src/components/advertising-payment-panel';
const root=createRoot(document.getElementById('root'));
window.mountPayments=props=>flushSync(()=>root.render(React.createElement(AdvertisingPaymentPanel,{...props,onDenied:message=>window.paymentDenials.push(message)})));
