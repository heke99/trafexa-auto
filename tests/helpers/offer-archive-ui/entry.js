import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DealOffers } from '../../../src/components/deal-offers';
import { DealerWorkspace } from '../../../src/components/dealer-workspace';

const root = createRoot(document.getElementById('root'));
window.mountArchiveFixture = (props) => {
  const element = props.workspace
    ? React.createElement(DealerWorkspace, { snapshot: props.snapshot, section: props.section ?? 'deals', demo: props.demo })
    : React.createElement(DealOffers, props);
  flushSync(() => root.render(element));
};
