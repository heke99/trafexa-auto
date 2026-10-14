import React from 'react';
import {createRoot} from 'react-dom/client';
import {ContractTemplateWorkspace} from '../../../src/components/contract-template-workspace';
import {DealContracts} from '../../../src/components/deal-contracts';
const root=createRoot(document.getElementById('root'));
window.mountContracts=props=>{window.contractProps=props;root.render(React.createElement(React.StrictMode,null,React.createElement(props.deal?DealContracts:ContractTemplateWorkspace,props)));};
