import React from 'react';
import {createRoot} from 'react-dom/client';
import {PurchaseCondition} from '../../../src/components/purchase-condition';
const root=createRoot(document.getElementById('root'));
window.mountPurchaseCondition=props=>{window.currentPurchaseProps=props;root.render(React.createElement(React.StrictMode,null,React.createElement(PurchaseCondition,props)));};
