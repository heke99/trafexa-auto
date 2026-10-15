import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CompanyBranches } from '../../../src/components/company-branches';
const root = createRoot(document.getElementById('root'));
window.mountBranches = props => flushSync(() => root.render(React.createElement(CompanyBranches, props)));
