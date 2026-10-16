import React from 'react';
import {createRoot} from 'react-dom/client';
import {CustomerEmailDelivery} from '../../../src/components/customer-email-delivery';
const root=createRoot(document.getElementById('root'));
window.mountCustomerEmail=props=>{window.customerEmailActor={userId:props.userId,role:props.role};root.render(React.createElement(React.StrictMode,null,React.createElement(CustomerEmailDelivery,props)));};
