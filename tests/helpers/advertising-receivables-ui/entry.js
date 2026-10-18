import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {PlatformAdvertisingReceivables} from '../../../src/components/platform-advertising-receivables';
const root=createRoot(document.getElementById('root'));
window.mountReceivables=props=>flushSync(()=>root.render(React.createElement(PlatformAdvertisingReceivables,{...props,onDenied:message=>window.receivablesDenials.push(message),onBusyChange:busy=>{window.receivablesBusy=busy;window.receivablesBusyEvents.push(busy);}})));
