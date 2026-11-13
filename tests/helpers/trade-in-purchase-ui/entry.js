import React from 'react';
import {createRoot} from 'react-dom/client';
import {DealTradeInPurchase} from '../../../src/components/deal-trade-in-purchase';
import {DealerWorkspace} from '../../../src/components/dealer-workspace';
const root=createRoot(document.getElementById('root'));
window.mountPurchase=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(DealTradeInPurchase,{...props,onBusyChange:value=>(window.fixture.busy??=[]).push(value),onAccessDenied:message=>(window.fixture.denied??=[]).push(message)})));
window.mountPurchaseWorkspace=snapshot=>{window.fixture.snapshot=snapshot;root.render(React.createElement(React.StrictMode,null,React.createElement(DealerWorkspace,{snapshot,section:'deals'})));};
