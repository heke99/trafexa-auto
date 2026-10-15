import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AdvertisingBillingPanel } from '../../../src/components/advertising-billing-panel';
const root = createRoot(document.getElementById('root'));
window.mountBilling = props => flushSync(() => root.render(React.createElement(AdvertisingBillingPanel, props)));
