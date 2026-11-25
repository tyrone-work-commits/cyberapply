"""Keep an identity handoff's original page alive when its person closes it.

Only the human/AI dropdown uses this controller. It observes a manual close
request; it never selects an answer, clicks an employer action, or restores a
destroyed page. Chrome's beforeunload cancellation preserves the live DOM/file.
"""
class IdentityCloseReturn:
    def __init__(self, context, page):
        self.page=page;self.requested=False;self.navigation_requested=False;self.session=None
        self.dialog_listener=self._dialog;self.navigation_listener=self._navigation
        try:
            self.session=context.new_cdp_session(page)
            self.session.send('Page.enable')
            self.frame_id=self.session.send('Page.getFrameTree')['frameTree']['frame']['id']
            self.session.on('Page.frameRequestedNavigation',self.navigation_listener)
            page.on('dialog',self.dialog_listener)
            page.evaluate("""()=>{
                const host=document.createElement('div');host.id='cyberapply-identity-return';
                const state={requested:false,active:true};window.__cyberapplyIdentityReturn=state;
                const before=e=>{if(state.active){e.preventDefault();e.returnValue='';}};
                state.before=before;window.addEventListener('beforeunload',before);
                const shadow=host.attachShadow({mode:'open'});
                shadow.innerHTML=`<style>:host{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px);font:15px/1.4 system-ui;color:#173c30}section{background:#fff;border:1px solid #b7cbbf;border-radius:12px;padding:14px;box-shadow:0 6px 30px #0003;max-width:320px}p{margin:0 0 10px}button{font:inherit;padding:10px 14px;border:0;border-radius:8px;background:#21644f;color:white;cursor:pointer}</style><section aria-label="CyberApply manual answer"><p role="status">Choose your answer, then close and return to the agent. This keeps the same form and CV in memory.</p><button type="button">Close and return to agent</button></section>`;
                shadow.querySelector('button').addEventListener('click',e=>{if(e.isTrusted)state.requested=true;});
                document.documentElement.appendChild(host);
            }""")
        except Exception:
            self.dispose();raise

    def _navigation(self,event):
        # Website/anchor navigation is not a person's window-close action.
        if event.get('frameId')==self.frame_id:self.navigation_requested=True

    def _dialog(self,dialog):
        if dialog.type=='beforeunload':
            dialog.dismiss()  # Cancel destruction of the exact filled page.
            self.requested=True
        else:dialog.dismiss()  # Preserve Playwright's ordinary default behavior.

    def wants_return(self):
        return self.requested or self.page.evaluate('()=>window.__cyberapplyIdentityReturn?.requested===true')

    def incomplete(self):
        self.requested=False
        self.page.evaluate("""()=>{const s=window.__cyberapplyIdentityReturn;if(s)s.requested=false;const p=document.querySelector('#cyberapply-identity-return')?.shadowRoot?.querySelector('[role=status]');if(p)p.textContent='Choose a valid answer from the dropdown first. Your form is still open; nothing was submitted.';}""")

    def dispose(self):
        try:
            self.page.remove_listener('dialog',self.dialog_listener)
            if not self.page.is_closed():self.page.evaluate("""()=>{const s=window.__cyberapplyIdentityReturn;if(s){s.active=false;window.removeEventListener('beforeunload',s.before);delete window.__cyberapplyIdentityReturn;}document.querySelector('#cyberapply-identity-return')?.remove();}""")
        except Exception:pass
        if self.session:
            try:self.session.detach()
            except Exception:pass
