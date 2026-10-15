import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AdvertisingInvoicePanel } from '../../../src/components/advertising-invoice-panel';
const root = createRoot(document.getElementById('root'));
window.mountInvoices = props => flushSync(() => root.render(React.createElement(AdvertisingInvoicePanel, props)));
