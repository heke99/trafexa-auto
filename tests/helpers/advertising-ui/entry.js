import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AdvertisingWorkspace } from '../../../src/components/advertising-workspace';
const root = createRoot(document.getElementById('root'));
window.mountAdvertisingFixture = ({ strict = false, ...props }) => {
  const component = React.createElement(AdvertisingWorkspace, props);
  flushSync(() => root.render(strict ? React.createElement(React.StrictMode, null, component) : component));
};
