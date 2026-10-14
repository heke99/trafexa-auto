import React from 'react';
import { createRoot } from 'react-dom/client';
import { DealerOfferReviews } from '../../../src/components/dealer-offer-reviews';
import { CustomerOfferReviews } from '../../../src/components/customer-offer-reviews';
const root = createRoot(document.getElementById('root'));
window.mountReviews = props => root.render(React.createElement(React.StrictMode,null,React.createElement(props.customer ? CustomerOfferReviews : DealerOfferReviews,props)));
