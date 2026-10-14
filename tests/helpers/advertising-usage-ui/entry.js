import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AdvertisingUsagePanel} from '../../../src/components/advertising-usage-panel';
const root = createRoot(document.getElementById('root'));
window.mountUsage = props => flushSync(() => root.render(React.createElement(AdvertisingUsagePanel, props)));
