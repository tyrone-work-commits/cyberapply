"""Explore gesture and submission checks against a running local app.

Uses an isolated browser, fictional demo jobs and captured-email QA accounts.
No real employer or mailbox requests are made.
"""
import argparse
import copy
import json
import os
import re
import secrets
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def drag(page, distance):
    card = page.locator('.swipe-card')
    card.scroll_into_view_if_needed()
    box = card.bounding_box()
    x = box['x'] + box['width'] * (.7 if distance < 0 else .3)
    y = box['y'] + 125
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + distance, y + 3, steps=12)
    no_overflow(page)
    page.mouse.up()


def touch(page, dx=0, dy=0, cancel=False, description=False):
    target = page.locator('.swipe-description' if description else '.swipe-card')
    target.scroll_into_view_if_needed()
    box = target.bounding_box()
    x = box['x'] + box['width'] * (.72 if dx < 0 else .28)
    y = box['y'] + min(box['height'] * .65, 125)
    cdp = page.context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for step in range(1, 13):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * step / 12, 'y': y + dy * step / 12}]})
    no_overflow(page)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel' if cancel else 'touchEnd', 'touchPoints': []})
    cdp.detach()


def demo_state(page):
    return page.evaluate("JSON.parse(sessionStorage.getItem('cyberapply-demo-data'))")


def restore_demo(page, state):
    page.evaluate("value => sessionStorage.setItem('cyberapply-demo-data', JSON.stringify(value))", state)
    page.reload(wait_until='networkidle')
    expect(page.locator('.swipe-card')).to_be_visible()
    expect(page.get_by_role('button', name='Apply to current role automatically')).to_be_enabled()


def checked(response):
    assert response.ok, f'{response.status}: {response.text()}'
    return response.json()


def qa_session(context, base):
    caps = checked(context.request.get(f'{base}/api/v1/auth/capabilities'))
    assert caps['auth_mode'] == 'local' and caps['email_delivery'] == 'capture'
    credentials = {
        'email': f'swipe-qa-{uuid.uuid4().hex}@example.com',
        'password': 'Qa-9!' + secrets.token_urlsafe(24),
    }
    checked(context.request.post(f'{base}/api/v1/auth/register', data=credentials))
    session = checked(context.request.post(f'{base}/api/v1/auth/login', data=credentials))
    headers = {'Authorization': 'Bearer ' + session['access_token']}
    session['user'] = checked(context.request.get(f'{base}/api/v1/auth/me', headers=headers))
    profile = {
        'full_name': 'Fictional Swipe QA', 'email': session['user']['email'],
        'skills': ['SIEM', 'Splunk', 'Incident response', 'AWS', 'Cloud security', 'Terraform', 'Python',
                   'Application security', 'OWASP', 'Secure coding', 'NIST', 'ISO 27001', 'Risk management',
                   'Digital forensics', 'Threat hunting', 'Zero trust', 'Network security'],
        'certifications': ['CompTIA Security+', 'CISA', 'GCIH', 'CISSP'],
        'years_experience': 15,
    }
    checked(context.request.put(f'{base}/api/v1/profiles/me', headers=headers, data={'data': profile, 'confirmed': True}))
    checked(context.request.put(f'{base}/api/v1/preferences/me', headers=headers, data={
        'roles': ['SOC Analyst', 'Cloud Security Engineer', 'Application Security Engineer', 'GRC Consultant',
                  'Incident Response Lead', 'Security Architect'],
        'levels': ['entry', 'mid', 'senior'], 'work_modes': ['remote'], 'employment_types': ['full_time'],
    }))
    resume = checked(context.request.post(f'{base}/api/v1/resumes', headers=headers, data={
        'title': 'Fictional swipe QA résumé', 'text': 'Fictional QA candidate\nSkills: ' + ', '.join(profile['skills']),
    }))
    checked(context.request.post(f'{base}/api/v1/resumes/{resume["id"]}/review', headers=headers,
                                data={'version': resume['version'], 'profile_data': profile}))
    checked(context.request.post(f'{base}/api/v1/resumes/{resume["id"]}/select', headers=headers))
    return session, headers


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://localhost:3000')
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[2] / '.tmp' / 'frontend-qa'
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        edge = Path(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe'
        browser = playwright.chromium.launch(**({'executable_path': str(edge)} if edge.exists() else {}))
        context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until='networkidle')
        page.get_by_role('button', name='Explore the demo').click()
        expect(page.locator('.swipe-card')).to_have_count(1)
        expect(page.locator('.swipe-card')).to_contain_text('Cloud Security Engineer')
        seed = demo_state(page)
        first = page.locator('.swipe-card').get_attribute('data-job-id')
        drag(page, -35)
        expect(page.locator('.swipe-card')).to_have_attribute('data-job-id', first)
        assert not any(job['decision'] for job in demo_state(page)['jobs'])
        touch(page, dx=160, cancel=True)
        expect(page.locator('.swipe-card')).to_have_attribute('data-job-id', first)
        touch(page, dy=-90, description=True)
        expect(page.locator('.swipe-card')).to_have_attribute('data-job-id', first)
        assert page.locator('.swipe-description').evaluate('el => el.scrollTop') > 0
        assert len(demo_state(page)['applications']) == 1
        touch(page, dx=-165)
        expect(page.locator('.swipe-card')).not_to_have_attribute('data-job-id', first)
        page.reload(wait_until='networkidle')
        expect(page.locator('.swipe-card')).not_to_have_attribute('data-job-id', first)
        page.get_by_role('tab', name='Passed', exact=True).click()
        expect(page.locator('.job-card')).to_have_count(1)
        page.get_by_role('button', name='Return Cloud Security Engineer at Example Cloud', exact=True).click()
        expect(page.locator('.job-card')).to_have_count(0)
        page.get_by_role('tab', name='For you', exact=True).click()
        expect(page.locator('.swipe-card')).to_have_attribute('data-job-id', first)
        touch(page, dx=165)
        expect(page.locator('.swipe-receipt')).to_contain_text('Demo application confirmed')
        expect(page.locator('.swipe-receipt')).to_contain_text('no employer was contacted')
        expect(page.locator('.swipe-card')).not_to_have_attribute('data-job-id', first)
        sent = demo_state(page)['applications'][0]
        assert sent['mode'] == 'automatic' and sent['confirmation_id'] and sent['job_id'] == first
        assert demo_state(page)['automation']['mode'] == 'review'
        page.reload(wait_until='networkidle')
        expect(page.locator('.swipe-card')).not_to_have_attribute('data-job-id', first)
        print('PASS: touch left/right, short drag, cancel, vertical description scroll, passed restoration, persistence, automatic simulation')

        restore_demo(page, seed)
        page.locator('.swipe-card').focus()
        page.keyboard.press('ArrowRight')
        expect(page.locator('.swipe-receipt')).to_contain_text('Demo application confirmed')
        expect(page.locator('.swipe-card')).not_to_have_attribute('data-job-id', first)
        page.locator('.swipe-card').focus()
        page.keyboard.press('ArrowLeft')
        expect(page.locator('.swipe-card')).to_contain_text('GRC Consultant')
        for condition in ['profile', 'resume', 'pause', 'quota']:
            altered = copy.deepcopy(seed)
            if condition == 'profile':
                altered['profile']['confirmed'] = False
            elif condition == 'resume':
                altered['resumes'][0]['reviewed'] = False
            elif condition == 'pause':
                altered['automation']['paused'] = True
            else:
                altered['automation']['remaining_today'] = 0
            restore_demo(page, altered)
            page.get_by_role('button', name='Apply to current role automatically').click()
            expect(page.get_by_role('dialog', name='Swipe application settings')).to_be_visible()
            assert len(demo_state(page)['applications']) == 1
            assert page.locator('.swipe-card').get_attribute('data-job-id') == first
        print('PASS: keyboard access and profile, résumé, pause and quota preflight')

        restore_demo(page, seed)
        for theme in ['paper', 'midnight', 'ocean', 'forest', 'ember']:
            # Use the theme picker so its application is verified through the UI.
            page.get_by_role('button', name='Choose theme', exact=True).click()
            dialog = page.get_by_role('dialog', name='A workspace that feels like you')
            dialog.get_by_role('button', name=re.compile('^' + theme.capitalize())).click()
            page.keyboard.press('Escape')
            expect(page.locator('html')).to_have_attribute('data-theme', theme)
            for width in [320, 390, 768, 1440]:
                page.set_viewport_size({'width': width, 'height': 844})
                no_overflow(page)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate('document.activeElement.blur(); window.scrollTo(0,0)')
        apply_bounds = page.get_by_role('button', name='Apply to current role automatically').bounding_box()
        assert apply_bounds['y'] + apply_bounds['height'] < 770, apply_bounds
        page.screenshot(path=str(output / 'swipe-mobile.png'))
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.screenshot(path=str(output / 'swipe-desktop.png'), full_page=True)
        print('PASS: five swipe themes, 20 viewport/theme combinations, visible mobile actions')

        # Real HTTP requests, with intercepted error/receipt responses before the real worker check.
        live = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        session, headers = qa_session(live, args.url)
        live.add_init_script('sessionStorage.setItem("cyberapply-session", ' + json.dumps(json.dumps(session)) + ')')
        page = live.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url + '/?view=explore', wait_until='networkidle')
        expect(page.locator('.swipe-card')).to_be_visible()
        actual_job = page.locator('.swipe-card').get_attribute('data-job-id')
        request_keys = []
        mocked_id = str(uuid.uuid4())
        polls = [0]

        def mock_submit(route):
            body = route.request.post_data_json
            assert body['mode'] == 'automatic' and body['job_id'] == actual_job
            request_keys.append(body['idempotency_key'])
            if len(request_keys) == 1:
                route.abort('failed')
            else:
                route.fulfill(json={'id': mocked_id, 'status': 'queued', 'is_demo': False, 'confirmation_id': None})

        def mock_poll(route):
            polls[0] += 1
            route.fulfill(json={'id': mocked_id, 'status': 'queued' if polls[0] == 1 else 'applied',
                                'is_demo': False, 'confirmation_id': None if polls[0] == 1 else 'fictional-test-receipt'})

        page.route('**/api/v1/applications', mock_submit)
        page.route(f'**/api/v1/applications/{mocked_id}', mock_poll)
        page.get_by_role('button', name='Apply to current role automatically').click()
        expect(page.get_by_role('alert').filter(has_text='could not connect')).to_be_visible()
        expect(page.locator('.swipe-card')).to_have_attribute('data-job-id', actual_job)
        page.get_by_role('button', name='Apply to current role automatically').evaluate('el => {el.click(); el.click();}')
        expect(page.locator('.swipe-receipt')).to_contain_text('Queued to apply automatically')
        expect(page.locator('.swipe-receipt')).not_to_contain_text('Application sent')
        expect(page.locator('.swipe-receipt')).to_contain_text('Application sent', timeout=12000)
        assert len(request_keys) == 2 and request_keys[0] == request_keys[1]
        page.unroute('**/api/v1/applications', mock_submit)
        page.unroute(f'**/api/v1/applications/{mocked_id}', mock_poll)
        page.reload(wait_until='networkidle')

        def needs_attention(route):
            route.fulfill(json={'id': mocked_id, 'status': 'needs_attention', 'is_demo': False,
                                'confirmation_id': None, 'missing_fields': ['phone'],
                                'error_message': 'Employer connection is unavailable.'})

        page.route('**/api/v1/applications', needs_attention)
        page.get_by_role('button', name='Apply to current role automatically').click()
        expect(page.locator('.swipe-receipt')).to_contain_text('Application needs attention')
        expect(page.locator('.swipe-receipt')).to_contain_text('Complete: Phone')
        expect(page.locator('.swipe-receipt')).not_to_contain_text('Application sent')
        page.unroute('**/api/v1/applications', needs_attention)
        page.reload(wait_until='networkidle')
        print('PASS: failed request snaps back, retry reuses its key, repeated click queues once, receipt polling and attention states')

        job = checked(live.request.get(f'{args.url}/api/v1/jobs/{actual_job}', headers=headers))
        assert job['is_demo'] and job['connector_key'] == 'demo', 'Only fictional jobs may be submitted in QA'
        touch(page, dx=165)
        expect(page.locator('.swipe-receipt')).to_contain_text('Demo application confirmed', timeout=25000)
        applications = checked(live.request.get(f'{args.url}/api/v1/applications', headers=headers))['items']
        assert len(applications) == 1
        application = applications[0]
        assert application['job_id'] == actual_job and application['mode'] == 'automatic'
        assert application['status'] == 'applied' and application['confirmation_id'] and application['is_demo']
        automation = checked(live.request.get(f'{args.url}/api/v1/automation', headers=headers))
        assert automation['mode'] == 'review' and automation['used_today'] == 1
        page.reload(wait_until='networkidle')
        expect(page.locator('.swipe-card')).not_to_have_attribute('data-job-id', actual_job)
        assert not errors, errors
        print('PASS: real local account -> reviewed main résumé -> touch right -> automatic queue -> worker -> confirmed simulation; no global automation change or repeat listing')
        live.close()
        context.close()
        browser.close()


if __name__ == '__main__':
    main()
