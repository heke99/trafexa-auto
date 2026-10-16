import React from 'react';
import {createRoot} from 'react-dom/client';
import {GuestCustomerDocument} from '../../../src/components/guest-customer-document';
const root=createRoot(document.getElementById('root'));
window.mountGuestDocument=document=>root.render(React.createElement(React.StrictMode,null,React.createElement(GuestCustomerDocument,{key:`${document.kind}:${document.kind==='offer'?document.review.id:document.signing.id}`,initialDocument:document})));
