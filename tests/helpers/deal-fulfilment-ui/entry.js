import React from 'react';
import { createRoot } from 'react-dom/client';
import { DealFulfilment } from '../../../src/components/deal-fulfilment';
const root=createRoot(document.getElementById('root'));
window.mountFulfilment=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(DealFulfilment,{...props,onDelivered:()=>window.fixture.delivered++})));
