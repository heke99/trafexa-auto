import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {FinanceRequestForm} from '../../../src/components/finance-request-form';
const root=createRoot(document.getElementById('root'));
window.mountFinance=props=>{window.fixture.scope={companyId:props.companyId,actorId:props.snapshot.user.id,role:props.snapshot.membership.role};flushSync(()=>root.render(React.createElement(FinanceRequestForm,props)));};
