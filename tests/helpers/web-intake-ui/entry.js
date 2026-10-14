import React from 'react';
import { createRoot } from 'react-dom/client';
import { PilotForm } from '../../../src/components/pilot-form';
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(PilotForm)));
