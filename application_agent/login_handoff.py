"""Private sign-in window; never reads or fills the user's credentials."""
import time


def sign_in(runtime,launch_options,state,url,hosts,authorize,timeout=240):
    import tkinter as tk
    from .browser import ApplicationAttention,validate_public_url,restrict_transports
    login_browser=None
    window=None
    try:
        login_browser=runtime.chromium.launch(**{**launch_options,'headless':False})
        context=login_browser.new_context(accept_downloads=False,service_workers='block',**({'storage_state':state} if state else {}))
        restrict_transports(context)
        unsupported=[]
        def guard(route):
            try:
                validate_public_url(route.request.url,hosts)
                if route.request.method not in ('GET','HEAD','OPTIONS') and authorize() is not True:
                    raise ApplicationAttention('Application authorization expired.')
                route.continue_()
            except ApplicationAttention:
                if route.request.resource_type=='document':unsupported.append(True)
                route.abort()
        context.route('**/*',guard)
        page=context.new_page()
        page.goto(url,wait_until='domcontentloaded',timeout=30000)
        window=tk.Tk()
        window.title('CyberApply — sign in privately')
        window.geometry('520x235')
        tk.Label(window,text='Sign in to the employer in the opened Chrome window.',wraplength=470,font=('Segoe UI',11,'bold')).pack(padx=20,pady=(20,10))
        tk.Label(window,text='Enter passwords and verification codes there yourself.\nCyberApply does not read or save those input fields.\nYour resulting sign-in session will be encrypted locally\nfor this employer and CyberApply account, for up to 14 days.',font=('Segoe UI',10)).pack(padx=15)
        done={'continue':False,'cancel':False}
        tk.Button(window,text='I have signed in — continue application',command=lambda:done.update({'continue':True})).pack(pady=12)
        tk.Button(window,text='Cancel',command=lambda:done.update({'cancel':True})).pack()
        window.protocol('WM_DELETE_WINDOW',lambda:done.update({'cancel':True}))
        window.update_idletasks()
        window.withdraw()
        window.deiconify()
        window.lift()
        deadline=time.monotonic()+timeout
        next_check=0
        while time.monotonic()<deadline:
            window.update()
            page.wait_for_timeout(250)
            if unsupported:raise ApplicationAttention('This sign-in uses an unsupported identity-provider destination. Complete this application manually.')
            if done['cancel']:return None
            if time.monotonic()>=next_check:
                if authorize() is not True:raise ApplicationAttention('This application no longer has current authorization.')
                next_check=time.monotonic()+10
            if done['continue']:
                validate_public_url(page.url,hosts)
                if page.locator('input[type="password"]:visible').count():
                    done['continue']=False
                    window.title('CyberApply — finish signing in first')
                    continue
                return {'state':context.storage_state(),'url':page.url}
        return None
    finally:
        if window:
            try:window.destroy()
            except Exception:pass
        if login_browser:
            try:login_browser.close()
            except Exception:pass
