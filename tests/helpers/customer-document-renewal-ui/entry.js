import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CustomerDocumentRenewal} from '../../../src/components/customer-document-renewal';
import {CustomerEmailDelivery} from '../../../src/components/customer-email-delivery';
const root=createRoot(document.getElementById('root'));
window.mountRenewal=props=>flushSync(()=>root.render(React.createElement(CustomerDocumentRenewal,{...props,onBusyChange:blocked=>{window.renewalBlocked=blocked;window.renewalBlockEvents.push(blocked);},onDenied:message=>window.renewalDenials.push(message),onRenewed:()=>window.renewalConfirmed++})));
window.mountDelivery=props=>{window.customerEmailActor={userId:props.userId,role:props.role};flushSync(()=>root.render(React.createElement(CustomerEmailDelivery,props)));};
