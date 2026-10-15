import React from 'react';
import {createRoot} from 'react-dom/client';
import {BlocketProvisioning} from '@/components/blocket-provisioning';
const root=createRoot(document.getElementById('root'));
window.mountBlocketFixture=props=>root.render(React.createElement(BlocketProvisioning,props));
