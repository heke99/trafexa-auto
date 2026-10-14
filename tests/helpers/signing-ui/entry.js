import React from 'react';
import {createRoot} from 'react-dom/client';
import {ContractSignatureInput} from '../../../src/components/contract-signature-input';
import {CustomerContractSignings,DealerContractSignings} from '../../../src/components/contract-signings';
const root=createRoot(document.getElementById('root'));
window.mountSigning=props=>root.render(React.createElement(React.StrictMode,null,props.signature?React.createElement(ContractSignatureInput,{disabled:props.disabled,onChange:value=>window.fixture.signatures.push(value)}):React.createElement(props.companyId?DealerContractSignings:CustomerContractSignings,props)));
