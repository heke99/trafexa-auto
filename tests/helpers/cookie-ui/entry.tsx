import React from 'react';
import { createRoot } from 'react-dom/client';
declare global { interface Window { mountCookieFixture: () => void; } }
import { CookieConsent, CookieSettingsButton } from '../../../src/components/cookie-consent.tsx';
window.mountCookieFixture = () => createRoot(document.getElementById('root')!).render(<React.StrictMode><main><button id="application">Skicka ansökan</button><CookieSettingsButton/></main><CookieConsent/></React.StrictMode>);
