import React from 'react';
import {createRoot} from 'react-dom/client';
import {DealTradeIns} from '../../../src/components/deal-trade-ins';
const root=createRoot(document.getElementById('root'));
window.mountTradeIn=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(DealTradeIns,{...props,onBusyChange:value=>(window.fixture.busy??=[]).push(value),onAccessDenied:message=>(window.fixture.denied??=[]).push(message)})));
