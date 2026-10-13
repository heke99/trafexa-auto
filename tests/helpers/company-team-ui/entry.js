import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CompanyTeam } from '../../../src/components/company-team';
import { CompanyInvitations } from '../../../src/components/company-invitations';
const root = createRoot(document.getElementById('root'));
window.mountTeamFixture = ({ invitations = false, strict = false, ...props }) => {
  const component = invitations ? React.createElement(CompanyInvitations) : React.createElement(CompanyTeam, props);
  flushSync(() => root.render(strict ? React.createElement(React.StrictMode, null, component) : component));
};
