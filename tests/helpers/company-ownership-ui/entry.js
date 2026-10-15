import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CompanyOwnershipTransfer } from '../../../src/components/company-ownership-transfer';
const root = createRoot(document.getElementById('root'));
window.mountOwnership = props => flushSync(() => root.render(React.createElement(CompanyOwnershipTransfer, { ...props, onChanged: async () => { window.fixture.parentRefreshes++; } })));
import { CompanyTeam } from '../../../src/components/company-team';
window.mountOwnershipTeam = props => flushSync(() => root.render(React.createElement(CompanyTeam, props)));
window.mountOwnershipStrict = props => flushSync(() => root.render(React.createElement(React.StrictMode, null, React.createElement(CompanyOwnershipTransfer, props))));
