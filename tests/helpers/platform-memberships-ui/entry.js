import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {PlatformAdminWorkspace} from '../../../src/components/platform-admin-workspace';
import {PlatformCompanyMembers,PlatformAccountMemberships} from '../../../src/components/platform-memberships';
const root=createRoot(document.getElementById('root'));
window.mountMemberships=props=>flushSync(()=>root.render(React.createElement(PlatformCompanyMembers,{...props,onAccessDenied:message=>{window.fixture.denials.push(message);}})));
window.mountAccountMemberships=props=>flushSync(()=>root.render(React.createElement(PlatformAccountMemberships,{...props,onAccessDenied:message=>window.fixture.denials.push(message),onClose:()=>window.fixture.closes++,onOpenCompany:company=>window.fixture.openedCompanies.push(company)})));
window.mountAdminFixture=props=>flushSync(()=>root.render(React.createElement(PlatformAdminWorkspace,props)));
