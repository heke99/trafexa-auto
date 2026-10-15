import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AdvertisingFinancialPanel } from '../../../src/components/advertising-financial-panel';
const root=createRoot(document.getElementById('root'));
window.mountFinancial=props=>flushSync(()=>root.render(React.createElement(AdvertisingFinancialPanel,props)));
