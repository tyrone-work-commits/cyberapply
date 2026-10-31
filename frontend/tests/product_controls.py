"""Production browser checks for product controls; only fictional local accounts.

Run: .venv/Scripts/python.exe frontend/tests/product_controls.py --url http://localhost:3000
Requires the local API, worker and production frontend. Never contacts employers.
"""
import argparse
import io
import json
import re
import secrets
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyotp
from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://localhost:3000')
    parser.add_argument('--live-only', action='store_true', help='Run account security/sync checks only')
    args = parser.parse_args()
    assert re.match(r'^http://(localhost|127\.0\.0\.1):\d+/?$', args.url), 'Local preview only'
    output = Path(__file__).resolve().parents[2] / '.tmp/frontend-qa'
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
        errors = []
        if not args.live_only:
            context = browser.new_context(viewport={'width':390,'height':844}, reduced_motion='reduce', accept_downloads=True)
            page = context.new_page()
            errors = []; page.on('pageerror', lambda error:errors.append(str(error)))
            page.goto(args.url, wait_until='networkidle')
            page.get_by_role('button',name='Explore the demo').click()
            expect(page.locator('.swipe-card')).to_be_visible()
            page.get_by_role('button',name='Apply to current role automatically').click()
            expect(page.get_by_role('button',name='Undo application')).to_be_visible()
            page.get_by_role('button',name='Undo application').click()
            expect(page.locator('.swipe-card')).to_contain_text('Cloud Security Engineer')
            page.get_by_role('button',name='Apply to current role automatically').click()
            page.reload(wait_until='networkidle')
            expect(page.get_by_role('button',name='Undo application')).to_be_visible()
            page.get_by_role('button',name='Undo application').click()
            page.get_by_role('button',name='Swipe application settings').click()
            expect(page.get_by_role('checkbox',name='Choose the best reviewed')).to_be_checked()
            page.get_by_role('button',name='Suggest a targeted résumé').click()
            expect(page.get_by_role('dialog').last).to_contain_text('TARGET ROLE: Cloud Security Engineer')
            page.get_by_role('button',name='Create draft and review').click()
            expect(page.get_by_role('dialog').last).to_contain_text('Candidate facts')
            expect(page.get_by_role('checkbox',name='I have reviewed')).not_to_be_checked()
            page.get_by_role('dialog').last.get_by_role('button',name='Close dialog').click()
            page.locator('.bottom-nav').get_by_role('button',name='Applications',exact=True).click()
            page.get_by_role('button',name='Schedule',exact=True).click()
            page.get_by_label('Title',exact=True).fill('Demo interview follow-up')
            page.get_by_label('Date and time',exact=True).fill('2026-12-20T12:00')
            page.get_by_role('button',name='Save schedule').click()
            expect(page.locator('.schedule-item')).to_contain_text('Demo interview follow-up')
            with page.expect_download() as download:
                page.get_by_role('button',name='Add to calendar').click()
            assert 'BEGIN:VALARM' in Path(download.value.path()).read_text()
            page.get_by_role('button',name='Mark done',exact=True).click()
            page.get_by_role('button',name='Completed',exact=True).click()
            expect(page.locator('.schedule-item')).to_contain_text('Demo interview follow-up')
            page.locator('.bottom-nav').get_by_role('button',name='Explore',exact=True).click()
            for theme in ['paper','midnight','ocean','forest','ember']:
                page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
                for font in ['100%','200%']:
                    page.evaluate('(size)=>document.documentElement.style.fontSize=size',font)
                    for width in [320,390,768,1440]:
                        page.set_viewport_size({'width':width,'height':900})
                        assert page.evaluate('document.documentElement.scrollWidth-innerWidth')<=1,(theme,font,width)
            page.set_viewport_size({'width':390,'height':844})
            page.evaluate("document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='paper'")
            page.get_by_role('button',name='Save current job').click()
            page.wait_for_function("sessionStorage.getItem('cyberapply-offline-account')==='demo-user'")
            page.evaluate('async()=>{await navigator.serviceWorker.ready}')
            page.wait_for_function('!!navigator.serviceWorker.controller')
            page.wait_for_timeout(300)
            cached = page.evaluate('async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).map(r=>new URL(r.url).pathname)))).flat()}')
            assert '/offline.html' in cached and not any('/api/' in path or '/auth/' in path or path=='/' for path in cached)
            await_saved = "async()=>new Promise(resolve=>{const r=indexedDB.open('cyberapply-offline-v1');r.onsuccess=()=>{const q=r.result.transaction('saved').objectStore('saved').get('demo-user');q.onsuccess=()=>resolve(q.result?.jobs?.length>0)}})"
            page.wait_for_function(await_saved)
            context.set_offline(True)
            page.reload(wait_until='load')
            expect(page.get_by_role('heading',name='Your saved jobs, offline.')).to_be_visible()
            page.get_by_role('button',name='Choose to apply when online').click()
            expect(page.get_by_text('Waiting for connection',exact=False)).to_be_visible()
            context.set_offline(False)
            page.goto(args.url,wait_until='networkidle')
            expect(page.get_by_role('button',name='Review choices')).to_be_visible()
            state = page.evaluate("JSON.parse(sessionStorage.getItem('cyberapply-demo-data'))")
            assert not any(app['mode']=='automatic' and app['status']!='cancelled' for app in state['applications'])
            page.get_by_role('button',name='Review choices').click()
            page.get_by_role('button',name='Apply now',exact=True).click()
            expect(page.get_by_role('dialog').get_by_role('button',name='Undo application')).to_be_visible()
            page.get_by_role('dialog').get_by_role('button',name='Undo application').click()
            page.get_by_role('dialog').get_by_role('button',name='Close dialog').click()
            page.get_by_role('button',name='Create your account',exact=True).click()
            assert page.evaluate("sessionStorage.getItem('cyberapply-offline-account')") is None
            print('PASS: Undo/reload/reaccept, factual draft review, schedules/calendar, 40 theme/text/viewport checks, production offline shell, explicit reconnect approval, cleared offline account')
            context.close()

        live=browser.new_context(viewport={'width':390,'height':844},accept_downloads=True)
        page=live.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        caps=live.request.get(args.url+'/api/v1/auth/capabilities').json()
        assert caps['auth_mode']=='local' and caps['email_delivery']=='capture'
        password='Qa-9!'+secrets.token_urlsafe(24)
        email='controls-qa-'+uuid.uuid4().hex+'@example.com'
        registered=live.request.post(args.url+'/api/v1/auth/register',data={'email':email,'password':password})
        assert registered.status==201,registered.text()
        signed=live.request.post(args.url+'/api/v1/auth/login',data={'email':email,'password':password})
        assert signed.status==200,signed.text()
        session=signed.json()
        auth={'Authorization':'Bearer '+session['access_token']}
        def api(path,method='GET',body=None):
            response=live.request.fetch(args.url+'/api/v1'+path,method=method,headers=auth,data=body)
            assert response.status in [200,201,202,204],response.text()
            return response.json() if response.status!=204 else None
        jobs=api('/jobs?limit=100')['items'];job=next(job for job in jobs if job['is_demo'] and job['active'])
        facts={'full_name':'Controls QA','email':email,'skills':job['required_skills'],'certifications':job['required_certifications'],'years_experience':10,'work_authorization':{'NG':True,'US':True},'citizenships':['NG','US'],'security_clearance':'top_secret','sponsorship_required':False}
        api('/profiles/me','PUT',{'data':facts,'confirmed':True})
        api('/preferences/me','PUT',{'roles':[job['title']]})
        resume=api('/resumes','POST',{'title':'Controls QA résumé','text':'Controls QA\nSKILLS\n'+', '.join(facts['skills'])})
        api('/resumes/'+resume['id']+'/review','POST',{'version':resume['version'],'profile_data':facts})
        page.goto(args.url,wait_until='networkidle')
        page.evaluate('session=>sessionStorage.setItem("cyberapply-session",JSON.stringify(session))',session)
        page.goto(args.url+'/?view=profile:appearance',wait_until='networkidle')
        page.get_by_role('button',name=re.compile('^Ocean')).click()
        page.get_by_label('Text size').select_option('large')
        expect(page.locator('html')).to_have_attribute('data-text-size','large')
        expect(page.get_by_text('Synced with your account',exact=True)).to_be_visible()
        preferences=api('/account/settings');assert preferences['theme']=='ocean' and preferences['text_size']=='large'
        second=browser.new_context();other=second.new_page();other.goto(args.url)
        other.evaluate('session=>sessionStorage.setItem("cyberapply-session",JSON.stringify(session))',session)
        other.reload(wait_until='networkidle')
        expect(other.locator('html')).to_have_attribute('data-theme','ocean')
        expect(other.locator('html')).to_have_attribute('data-text-size','large')
        second.close()
        page.goto(args.url+'/?view=profile:account',wait_until='networkidle')
        page.get_by_role('button',name='Set up authenticator').click()
        page.get_by_label('Current account password').fill(password)
        page.get_by_role('dialog').get_by_role('button',name='Continue',exact=True).click()
        expect(page.get_by_role('dialog',name='Connect your authenticator')).to_be_visible()
        expect(page.get_by_label('Manual authenticator setup key')).to_have_value(re.compile('^[A-Z2-7]{32}$'))
        key=page.get_by_label('Manual authenticator setup key').input_value()
        page.get_by_label('Six-digit authenticator code').fill(pyotp.TOTP(key).now())
        page.get_by_role('button',name='Verify and enable').click()
        expect(page.get_by_role('dialog',name='Save your recovery codes')).to_be_visible()
        recovery=page.locator('.recovery-list').inner_text().splitlines();assert len(recovery)==10
        page.get_by_role('checkbox',name='I have saved these recovery codes').check()
        page.get_by_role('dialog').get_by_role('button',name='Done',exact=True).click()
        page.get_by_role('button',name='Export my data').click()
        page.get_by_label('Current account password').fill(password)
        page.get_by_role('dialog',name='Export your private data').get_by_label('New authenticator or unused recovery code').fill(recovery[0])
        with page.expect_download() as exported:
            page.get_by_role('button',name='Download private export').click()
        with zipfile.ZipFile(exported.value.path()) as archive:
            content=archive.read('cyberapply-data.json').decode()
            assert email in content and password not in content and key not in content
        # Start another isolated tab to exercise password + recovery sign-in.
        signin=browser.new_context(viewport={'width':390,'height':844});login=signin.new_page();login.goto(args.url,wait_until='networkidle')
        login.get_by_role('button',name='Sign in',exact=True).click()
        login.get_by_label('Email address',exact=True).fill(email);login.get_by_label('Password',exact=True).fill(password)
        login.get_by_role('button',name='Sign in',exact=True).last.click()
        expect(login.get_by_role('dialog',name='Complete two-factor sign-in')).to_be_visible()
        assert login.evaluate("sessionStorage.getItem('cyberapply-session')") is None
        login.get_by_label('Authenticator or recovery code').fill(recovery[1])
        login.get_by_role('button',name='Verify and continue').click()
        expect(login.locator('main')).to_be_visible()
        signin.close()
        page.get_by_role('button',name='Delete my CyberApply account').click()
        page.get_by_label('Current account password').fill(password)
        page.get_by_role('dialog',name='Delete your CyberApply account').get_by_label('New authenticator or unused recovery code').fill(recovery[2])
        page.get_by_label('Type DELETE MY ACCOUNT to continue').fill('DELETE MY ACCOUNT')
        page.get_by_role('button',name='Delete account and sign out').click()
        expect(page.get_by_role('button',name='Explore the demo')).to_be_visible()
        assert live.request.get(args.url+'/api/v1/auth/me',headers=auth).status==401
        assert not errors,errors
        print('PASS: account theme/text sync across contexts, authenticator setup, recovery-only protected sign-in, secret-free export, own QA account deletion; no page errors')
        live.close();browser.close()


if __name__=='__main__':main()
