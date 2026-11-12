import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AdvertisingProgramWorkspace} from '../../../src/components/advertising-program-workspace';
const root=createRoot(document.getElementById('root'));
window.mountProgram=props=>flushSync(()=>root.render(React.createElement(AdvertisingProgramWorkspace,props)));
export function useRouter(){return {refresh(){window.programFixture.refreshes++;}};}
