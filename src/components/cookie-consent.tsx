'use client';
import { useEffect, useRef, useState } from 'react';
import { COOKIE_NOTICE_NAME, COOKIE_NOTICE_VALUE, COOKIE_NOTICE_MAX_AGE, COOKIE_SETTINGS_EVENT } from '@/lib/privacy/cookies';
import './cookie-consent.css';

export function CookieSettingsButton() {
  return <button type="button" className="cookie-settings-link" onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}>Cookieinställningar</button>;
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [settings, setSettings] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const acknowledged = document.cookie.split(';').some(entry => entry.trim() === `${COOKIE_NOTICE_NAME}=${COOKIE_NOTICE_VALUE}`);
    setVisible(!acknowledged);
    function reopen() { setSettings(true); setVisible(true); }
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
  }, []);
  useEffect(() => { if (visible && settings) heading.current?.focus(); }, [visible, settings]);
  function acknowledge() {
    document.cookie = `${COOKIE_NOTICE_NAME}=${COOKIE_NOTICE_VALUE}; Path=/; Max-Age=${COOKIE_NOTICE_MAX_AGE}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    setVisible(false); setSettings(false);
  }
  function forget() {
    document.cookie = `${COOKIE_NOTICE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    setSettings(false); setVisible(true);
  }
  if (!visible) return null;
  return <section className="cookie-notice" aria-labelledby="cookie-notice-title"><div>
    <h2 id="cookie-notice-title" ref={heading} tabIndex={-1}>Cookies på Trafexa</h2>
    <p>Vi använder endast nödvändiga cookies för inloggning, personliga dokumentlänkar, kontoaktivering, val av arbetsyta och för att komma ihåg att du har läst denna information. Vi använder inga cookies för statistik eller marknadsföring.</p>
    {settings && <p>Nödvändiga cookies kräver inget samtycke. Du kan blockera dem i webbläsaren, men då kan inloggning, dokumentlänkar och kontoaktivering sluta fungera. Din bekräftelse gäller i 180 dagar på denna webbplats.</p>}
    <a href="/cookies">Läs vår cookiepolicy</a><span aria-hidden="true"> · </span><a href="/privacy">Integritetspolicy</a>
  </div><div className="cookie-notice-actions"><button className="button button-green" type="button" onClick={acknowledge}>Jag förstår</button>{settings ? <button className="cookie-settings-link" type="button" onClick={forget}>Glöm min bekräftelse</button> : <button className="cookie-settings-link" type="button" onClick={() => setSettings(true)}>Visa inställningar</button>}</div></section>;
}
