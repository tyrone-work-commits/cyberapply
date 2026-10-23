"""OAuth browser checks with simulated providers; no external identity or account requests."""
import argparse
import base64
import hashlib
import os
import re
from pathlib import Path
from urllib.parse import urlencode, urlparse

from playwright.sync_api import expect, sync_playwright

ACCESS = 'provider-access-token-' + 'a' * 40
REFRESH = 'aB3dE6gH9jK2'  # Supabase's opaque refresh tokens can be 12 characters.
USER = {'id': '10000000-0000-4000-8000-000000000099', 'email': 'verified-provider@example.com', 'email_verified': True}
KEY = 'cyberapply-oauth-attempt'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://localhost:3001')
    args = parser.parse_args()
    base = args.url.rstrip('/')
    output = Path(__file__).resolve().parents[2] / '.tmp' / 'oauth-qa'
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    with sync_playwright() as p:
        edge = Path(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe'
        browser = p.chromium.launch(executable_path=str(edge))

        def scenario(mode='supabase', width=390):
            context = browser.new_context(viewport={'width': width, 'height': 844}, service_workers='block')
            page = context.new_page()
            errors, calls = [], []
            state = {'fail_capabilities': False, 'start_error': False, 'bad_url': False, 'mfa': False, 'verified': False,
                     'refresh': REFRESH}
            page.on('pageerror', lambda e: errors.append(str(e)))

            def api(route):
                path = urlparse(route.request.url).path.removeprefix('/api/v1')
                body = route.request.post_data_json if route.request.method == 'POST' else None
                calls.append((path, body))
                if path == '/auth/capabilities':
                    if state['fail_capabilities']:
                        route.abort()
                        return
                    ready = mode == 'supabase'
                    data = {'auth_mode': mode, 'google': ready, 'apple': ready, 'phone': False,
                            'providers': {'google': 'ready' if ready else 'not_configured', 'apple': 'ready' if ready else 'not_configured'},
                            'email_delivery': 'provider' if ready else 'capture'}
                elif path.endswith('/start'):
                    if state['start_error']:
                        route.fulfill(status=503, json={'detail': {'code': 'identity_provider_unavailable', 'message': 'Sign-in service is unavailable. Please try again'}})
                        return
                    provider = path.split('/')[3]
                    query = urlencode({'provider': provider, 'redirect_to': body['redirect_url'], 'code_challenge': body['code_challenge'], 'code_challenge_method': 's256'})
                    data = {'authorization_url': 'https://identity.example/auth/v1/authorize?' + query}
                    if state['bad_url']:
                        data['authorization_url'] = 'javascript:alert(1)'
                elif path == '/auth/oauth/exchange':
                    data = {'access_token': ACCESS, 'refresh_token': state['refresh'], 'user': {'id': 'forged', 'email': 'untrusted@example.com'}}
                elif path == '/auth/mfa/status':
                    assert route.request.headers.get('authorization') == 'Bearer ' + ACCESS
                    data = {'mode': 'supabase', 'verification_required': state['mfa'] and not state['verified'],
                            'factors': [{'id': 'factor-1', 'status': 'verified', 'factor_type': 'totp'}]}
                elif path == '/auth/mfa/provider/challenge':
                    data = {'id': 'challenge-1'}
                elif path == '/auth/mfa/provider/verify':
                    assert body == {'factor_id': 'factor-1', 'challenge_id': 'challenge-1', 'code': '123456'}
                    state['verified'] = True
                    data = {'access_token': ACCESS, 'refresh_token': REFRESH}
                elif path == '/auth/me':
                    assert route.request.headers.get('authorization') == 'Bearer ' + ACCESS
                    data = USER
                else:
                    route.fulfill(status=503, json={'detail': {'message': 'Unrelated workspace data is not part of this OAuth check'}})
                    return
                route.fulfill(json=data)

            page.route('**/api/v1/**', api)
            page.route('https://identity.example/**', lambda route: route.fulfill(content_type='text/html', body='<h1>Simulated account provider</h1>'))
            return context, page, state, calls, errors

        for width in [320, 390, 1440]:
            context, page, _, calls, errors = scenario('local', width)
            page.goto(base, wait_until='networkidle')
            for name in ['Google', 'Apple']:
                page.get_by_role('button', name='Continue with ' + name, exact=True).click()
                expect(page.locator('#oauth-status').get_by_role('alert')).to_contain_text(re.compile(name + ' sign-in.*set up'))
                assert page.evaluate("document.activeElement.id === 'oauth-status'")
                assert page.locator('#oauth-status').bounding_box()['y'] >= 0
            assert not any(path.endswith('/start') for path, _ in calls)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            page.screenshot(path=str(output / f'provider-feedback-{width}.png'), full_page=True)
            assert not errors, errors
            checks.append(f'visible Google/Apple setup feedback and focus at {width}px')
            context.close()

        for provider, mode in [('google', 'signup'), ('apple', 'signin')]:
            context, page, _, calls, errors = scenario()
            page.goto(base + ('/?auth=signin' if mode == 'signin' else ''), wait_until='networkidle')
            name = provider.title()
            page.get_by_role('button', name='Continue with ' + name, exact=True).click()
            page.wait_for_url('https://identity.example/**')
            # Storage is origin scoped: read it after returning to the app origin, before the callback exchange.
            page.goto(base, wait_until='networkidle')
            attempt = page.evaluate(f"JSON.parse(sessionStorage.getItem('{KEY}'))")
            start = next(body for path, body in calls if path == f'/auth/oauth/{provider}/start')
            challenge = base64.urlsafe_b64encode(hashlib.sha256(attempt['verifier'].encode()).digest()).decode().rstrip('=')
            assert challenge == start['code_challenge']
            assert attempt['provider'] == provider
            page.goto(base + '/auth/callback?code=single-use-provider-code-123')
            page.wait_for_url(base + '/')
            expect(page).not_to_have_url(re.compile('code='))
            session = page.evaluate("JSON.parse(sessionStorage.getItem('cyberapply-session'))")
            assert session['user'] == USER and session['access_token'] == ACCESS and session['refresh_token'] == REFRESH
            assert page.evaluate(f"sessionStorage.getItem('{KEY}')") is None
            exchange = [body for path, body in calls if path == '/auth/oauth/exchange']
            assert len(exchange) == 1 and exchange[0]['code_verifier'] == attempt['verifier']
            assert not errors, errors
            checks.append(f'{name} {mode} redirect, PKCE, single exchange and canonical verified session with opaque refresh token')
            context.close()

        for invalid_refresh in ['', 'r' * 4097]:
            context, page, state, calls, errors = scenario()
            state['refresh'] = invalid_refresh
            page.goto(base, wait_until='networkidle')
            page.get_by_role('button', name='Continue with Google', exact=True).click()
            page.wait_for_url('https://identity.example/**')
            page.goto(base + '/auth/callback?code=single-use-provider-code-123', wait_until='networkidle')
            expect(page.get_by_role('alert').first).to_contain_text('sign-in session is incomplete')
            assert page.evaluate("sessionStorage.getItem('cyberapply-session')") is None
            assert page.evaluate(f"sessionStorage.getItem('{KEY}')") is None
            assert not any(path in ['/auth/me', '/auth/mfa/status'] for path, _ in calls)
            assert not errors, errors
            checks.append('empty or oversized refresh token rejects session before persistence')
            context.close()

        for failure in ['start_error', 'bad_url']:
            context, page, state, _, errors = scenario()
            state[failure] = True
            page.goto(base, wait_until='networkidle')
            page.get_by_role('button', name='Continue with Google', exact=True).click()
            expect(page.locator('#oauth-status').get_by_role('alert')).to_be_visible()
            assert page.evaluate(f"sessionStorage.getItem('{KEY}')") is None
            expect(page.get_by_role('button', name='Continue with Apple', exact=True)).to_be_enabled()
            assert not errors, errors
            checks.append(f'{failure} cleans verifier and restores sign-in buttons')
            context.close()

        context, page, state, _, errors = scenario()
        state['fail_capabilities'] = True
        page.goto(base, wait_until='networkidle')
        expect(page.locator('#oauth-status').get_by_role('alert')).to_contain_text(re.compile('check the sign-in options'))
        state['fail_capabilities'] = False
        page.get_by_role('button', name='Check sign-in options again').click()
        expect(page.locator('#oauth-status').get_by_role('alert')).to_have_count(0)
        expect(page.get_by_role('button', name='Continue with Google', exact=True)).to_be_enabled()
        checks.append('capability connection failure can be retried')
        assert not errors, errors
        context.close()

        for failure in ['cancel', 'missing', 'expired', 'wrong-origin']:
            context, page, _, calls, errors = scenario()
            page.goto(base, wait_until='networkidle')
            if failure in ['expired', 'wrong-origin', 'cancel']:
                page.evaluate("([key,origin,failure])=>sessionStorage.setItem(key,JSON.stringify({verifier:'v'.repeat(64),provider:'google',redirectUrl:(failure==='wrong-origin'?'https://other.example':origin)+'/auth/callback',createdAt:Date.now()-(failure==='expired'?600001:0)}))", [KEY, base, failure])
            suffix = '?error=access_denied&error_description=private-info' if failure == 'cancel' else '?code=single-use-provider-code-123'
            page.goto(base + '/auth/callback' + suffix, wait_until='networkidle')
            expect(page.get_by_role('heading', name=re.compile('try that again'))).to_be_visible()
            assert '?' not in page.url and '#' not in page.url
            assert page.evaluate(f"sessionStorage.getItem('{KEY}')") is None
            assert page.evaluate("sessionStorage.getItem('cyberapply-session')") is None
            assert not any(path == '/auth/oauth/exchange' for path, _ in calls)
            assert not errors, errors
            checks.append(f'{failure} callback rejects session and cleans credentials')
            context.close()

        context, page, state, calls, errors = scenario()
        state['mfa'] = True
        page.goto(base, wait_until='networkidle')
        page.get_by_role('button', name='Continue with Apple', exact=True).click()
        page.wait_for_url('https://identity.example/**')
        page.goto(base + '/auth/callback?code=single-use-provider-code-123', wait_until='networkidle')
        dialog = page.get_by_role('dialog', name='Complete two-factor sign-in')
        expect(dialog).to_be_visible()
        assert page.evaluate("sessionStorage.getItem('cyberapply-session')") is None
        assert page.evaluate(f"sessionStorage.getItem('{KEY}')") is None
        dialog.get_by_label('Verification code', exact=True).fill('123456')
        dialog.get_by_role('button', name='Verify and continue').click()
        page.wait_for_url(base + '/')
        assert page.evaluate("JSON.parse(sessionStorage.getItem('cyberapply-session')).user.id") == USER['id']
        assert len([path for path, _ in calls if path == '/auth/oauth/exchange']) == 1
        assert not errors, errors
        checks.append('Apple callback waits for authoritative MFA before session persistence')
        context.close()
        browser.close()
    for check in checks:
        print('PASS:', check)
    print(f'{len(checks)} OAuth browser scenarios passed; all provider responses were simulated.')


if __name__ == '__main__':
    main()
