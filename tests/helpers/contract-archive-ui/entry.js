import React from 'react';
import {createRoot} from 'react-dom/client';
import {ContractArchive} from '../../../src/components/contract-archive';
import {CustomerContractSignings,DealerContractSignings} from '../../../src/components/contract-signings';

const root=createRoot(document.getElementById('root'));
window.mountArchive=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(ContractArchive,props)));
window.mountArchiveSignings=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(props.companyId?DealerContractSignings:CustomerContractSignings,props)));

const originalmountArchiveSignings=window.mountArchiveSignings;window.mountArchiveSignings=props=>{window.customerEmailActor={userId:props.userId,role:props.role};return originalmountArchiveSignings(props);};
