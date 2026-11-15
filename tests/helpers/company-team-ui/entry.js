import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CompanyTeam } from '../../../src/components/company-team';
import { CompanyInvitations } from '../../../src/components/company-invitations';
const root = createRoot(document.getElementById('root'));
window.mountTeamFixture = ({ invitations = false, strict = false, ...props }) => {
  const component = invitations ? React.createElement(CompanyInvitations,{userId:props.userId}) : React.createElement(CompanyTeam, {...props,onBusyChange:value=>(window.fixture.busyEvents??=[]).push(value),onAccessDenied:message=>(window.fixture.denials??=[]).push(message)});
  flushSync(() => root.render(strict ? React.createElement(React.StrictMode, null, component) : component));
};
