import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PlatformAdminActivation, PlatformAdminWorkspace } from '../../../src/components/platform-admin-workspace';
const root = createRoot(document.getElementById('root'));
window.mountAdminFixture = props => flushSync(() => root.render(props.activation
  ? React.createElement(PlatformAdminActivation)
  : React.createElement(PlatformAdminWorkspace, props)));
