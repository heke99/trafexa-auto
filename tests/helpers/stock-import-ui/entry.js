import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {StockImport} from '../../../src/components/stock-import';
const root=createRoot(document.getElementById('root'));
window.mountImport=props=>flushSync(()=>root.render(React.createElement(StockImport,{...props,onBusyChange:value=>{window.fixture.parentBusy=value;window.fixture.busyEvents.push(value);},onCompleted:()=>window.fixture.completed++,onAccessDenied:()=>window.fixture.denied++})));
