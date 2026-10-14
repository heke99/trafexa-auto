import React from 'react';
import { createRoot } from 'react-dom/client';
import { CustomerContactLog, CompanyFollowups } from '../../../src/components/customer-contact-log';
const root = createRoot(document.getElementById('root'));
window.mountCrmFixture = props => root.render(React.createElement(React.StrictMode, null, React.createElement(props.followups ? CompanyFollowups : CustomerContactLog, { ...props, onAccessDenied: () => { window.fixture.denied++; }, onSelectCustomer: customer => window.fixture.selected.push(customer) })));
