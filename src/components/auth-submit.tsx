'use client';

import {useFormStatus} from 'react-dom';
import type {ReactNode} from 'react';

/** Keep the server form action and its complete FormData intact. */
export function AuthSubmit({children,pendingLabel,className='button button-green'}:{children:ReactNode;pendingLabel:string;className?:string}){
 const {pending}=useFormStatus();
 return <button className={className} type="submit" disabled={pending} aria-busy={pending} aria-label={pending?pendingLabel:undefined} style={{maxWidth:'100%',whiteSpace:'normal'}}><span role={pending?'status':undefined}>{pending?pendingLabel:children}</span></button>;
}
