import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AdvertisingBillingCorrectionsPanel } from '../../../src/components/advertising-billing-corrections-panel';
const root = createRoot(document.getElementById('root'));
window.mountCorrections = props => flushSync(() => root.render(React.createElement(AdvertisingBillingCorrectionsPanel, props)));
