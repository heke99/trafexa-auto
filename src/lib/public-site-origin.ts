/** Explicit public links must not inherit the app host's dashboard rewrite. */
export function publicSiteUrl(path='/'):string{
 let base='https://www.trafexa.com';
 const configured=process.env.NEXT_PUBLIC_SITE_URL;
 if(configured)try{const u=new URL(configured),local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);if((u.protocol==='https:'||local&&u.protocol==='http:')&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&u.hostname!=='app.trafexa.com')base=u.origin;}catch{}
 const target=path.startsWith('/')&&!path.startsWith('//')?path:'/';
 return new URL(target,base).href;
}
