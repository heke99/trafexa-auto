import React from 'react';
export default function Link({href,children,prefetch,replace,scroll,...props}){return React.createElement('a',{...props,href:typeof href==='string'?href:href.pathname},children);}
