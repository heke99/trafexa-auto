import React from 'react';
import { createRoot } from 'react-dom/client';
import { DealCancellation } from '../../../src/components/deal-cancellation';
const root=createRoot(document.getElementById('root'));
window.mountCancellation=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(DealCancellation,{...props,onCancelled:receipt=>window.fixture.saved.push(receipt)})));
