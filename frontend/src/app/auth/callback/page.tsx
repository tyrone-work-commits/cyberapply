'use client';

import { useEffect } from 'react';
import { Brand } from '@/components/auth-screen';
import { Button } from '@/components/ui';

// Old links must never exchange credentials or start a session.
export default function Page() {
  useEffect(()=>{
    history.replaceState(null,'',location.pathname);
    sessionStorage.removeItem('cyberapply-oauth-attempt');
    sessionStorage.removeItem('cyberapply-pkce');
  },[]);
  return <main className="callback-page"><div className="stack">
    <Brand/><h1>This sign-in link is no longer supported.</h1>
    <p>Use email sign-in in this local prototype, or ChatGPT sign-in in the hosted Covenda app.</p>
    <Button onClick={()=>location.replace('/?auth=signin')}>Back to sign in</Button>
  </div></main>;
}
