import React from 'react';
import { createRoot } from 'react-dom/client';
import { CustomerContactLog, CompanyFollowups } from '../../../src/components/customer-contact-log';
const root = createRoot(document.getElementById('root'));
window.mountCrmFixture = props => root.render(React.createElement(React.StrictMode, null, React.createElement(props.followups ? CompanyFollowups : CustomerContactLog, { ...props, onBusyChange: value => { window.fixture.parentBusy=value; (window.fixture.busyEvents??=[]).push(value); }, onChanged: () => { window.fixture.changed=(window.fixture.changed??0)+1; }, onAccessDenied: () => { window.fixture.denied++; }, onSelectCustomer: customer => window.fixture.selected.push(customer) })));
