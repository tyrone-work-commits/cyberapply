"""Browser smoke checks for a running frontend and backend; no external contacts.

Run with the project's Python environment. Optional --live-registration creates
one fictional local QA account, and only runs when email delivery is capture.
"""
import argparse
import os
import re
import secrets
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def overflow_check(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://localhost:3000')
    parser.add_argument('--live-registration', action='store_true')
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[2] / '.tmp' / 'frontend-qa'
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        edge = Path(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe'
        browser = playwright.chromium.launch(**({'executable_path': str(edge)} if edge.exists() else {}))
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until='networkidle')
        expect(page.get_by_role('button', name='Continue with Google')).to_be_visible()
        expect(page.get_by_role('button', name='Continue with Apple')).to_be_visible()
        expect(page.get_by_role('button', name='Continue with phone')).to_be_visible()
        expect(page.get_by_label('Email address', exact=True)).to_be_visible()
        page.screenshot(path=str(output / 'signup-desktop.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        overflow_check(page)
        page.screenshot(path=str(output / 'signup-mobile.png'), full_page=True)
        page.get_by_role('button', name='Explore the demo').click()
        expect(page.locator('.demo-banner').get_by_text('Demo workspace', exact=True)).to_be_visible()
        expect(page.locator('.job-card')).to_have_count(6)
        page.screenshot(path=str(output / 'explore-mobile.png'), full_page=True)
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.get_by_role('button', name='Choose theme', exact=True).click()
        dialog = page.get_by_role('dialog', name='A workspace that feels like you')
        for theme in ['Paper', 'Midnight', 'Ocean', 'Forest', 'Ember']:
            dialog.get_by_role('button', name=re.compile('^' + theme)).click()
            expect(page.locator('html')).to_have_attribute('data-theme', theme.lower())
        dialog.get_by_role('button', name=re.compile('^Follow my device')).click()
        page.emulate_media(color_scheme='dark')
        expect(page.locator('html')).to_have_attribute('data-theme', 'midnight')
        page.emulate_media(color_scheme='light')
        expect(page.locator('html')).to_have_attribute('data-theme', 'paper')
        dialog.get_by_role('button', name=re.compile('^Midnight')).click()
        page.keyboard.press('Escape')
        expect(dialog).not_to_be_visible()
        assert page.evaluate('document.body.style.overflow') != 'hidden'
        page.reload(wait_until='networkidle')
        expect(page.locator('html')).to_have_attribute('data-theme', 'midnight')
        page.screenshot(path=str(output / 'explore-midnight.png'), full_page=True)
        for width in [320, 390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            for view in ['explore', 'search', 'applications', 'inbox', 'profile', 'profile:resume', 'profile:preferences', 'profile:automation', 'profile:appearance', 'profile:support']:
                page.goto(f'{args.url}/?view={view}', wait_until='networkidle')
                expect(page.locator('main')).to_be_visible()
                overflow_check(page)
        print('PASS: signup options, five themes, device theme, persistence, 40 responsive views, no page errors')
        assert not errors, errors

        if args.live_registration:
            live = browser.new_context(viewport={'width': 390, 'height': 844})
            page = live.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            caps = live.request.get(f'{args.url}/api/v1/auth/capabilities').json()
            assert caps['auth_mode'] == 'local' and caps['email_delivery'] == 'capture', 'Live test requires local capture mode'
            page.goto(args.url, wait_until='networkidle')
            email = f'frontend-qa-{uuid.uuid4().hex}@example.com'
            password = 'Qa-9!' + secrets.token_urlsafe(24)
            page.get_by_label('Email address', exact=True).fill(email)
            page.get_by_label('Password', exact=True).fill(password)
            page.get_by_role('button', name='Create your account', exact=True).click()
            setup = page.get_by_role('dialog', name='Your next chapter starts here')
            expect(setup).to_be_visible(timeout=20000)
            setup.get_by_label('Full name', exact=True).fill('Frontend QA')
            setup.get_by_label('Skills', exact=True).fill('SIEM, Splunk, Incident response')
            setup.get_by_label('Certifications you hold', exact=True).fill('CompTIA Security+')
            setup.get_by_role('checkbox', name='I have reviewed these facts').check()
            setup.get_by_role('button', name='Save and continue').click()
            setup.get_by_label('Roles you want', exact=True).fill('SOC Analyst')
            setup.get_by_role('button', name='Save and continue').click()
            setup.get_by_role('button', name='Create from text').click()
            create = page.get_by_role('dialog', name=re.compile('Create.*résumé', re.I))
            expect(create).to_be_visible()
            create.get_by_label('Résumé title', exact=True).fill('QA résumé')
            create.get_by_label('Résumé text', exact=True).fill('Frontend QA\nSkills: SIEM, Splunk, Incident response\nCertification: CompTIA Security+')
            create.get_by_role('button', name='Create and review').click()
            review = page.get_by_role('dialog', name='QA résumé', exact=True)
            expect(review).to_be_visible()
            review.get_by_role('checkbox', name='I have reviewed these facts').check()
            review.get_by_role('button', name='Confirm résumé facts').click()
            setup.get_by_role('button', name='Start exploring').click()
            expect(setup).not_to_be_visible()
            assert page.evaluate('document.body.style.overflow') != 'hidden', 'Nested dialogs must restore scrolling'
            overflow_check(page)
            # A single expired-access response must refresh, including on bootstrap.
            expired = [False]
            def expire_once(route):
                if not expired[0]:
                    expired[0] = True
                    route.fulfill(status=401, content_type='application/json', body='{"detail":{"message":"Expired"}}')
                else:
                    route.continue_()
            page.route('**/api/v1/auth/me', expire_once)
            page.reload(wait_until='networkidle')
            expect(page.locator('main')).to_be_visible()
            assert page.evaluate("!!sessionStorage.getItem('cyberapply-session')")
            page.unroute('**/api/v1/auth/me', expire_once)
            page.goto(f'{args.url}/?view=profile', wait_until='networkidle')
            expect(page.get_by_label('Full name', exact=True)).to_have_value('Frontend QA')
            assert not errors, errors
            print('PASS: live local registration -> confirmed profile -> preferences -> reviewed main resume; bootstrap refresh; nested dialog scrolling')
            live.close()
        context.close()
        browser.close()


if __name__ == '__main__':
    main()
