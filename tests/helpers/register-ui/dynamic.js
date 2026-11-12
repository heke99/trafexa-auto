import React from 'react';
export default function dynamic(){
 return function LazyUnrelated(props){if(Array.isArray(props.costs))window.fixture.calculationDenied=props.onDenied;return Array.isArray(props.costs)?React.createElement('div',{'data-testid':'calculation-consumer'},`Verifierade kostnadsposter: ${props.costs.length}`):null;};
}
