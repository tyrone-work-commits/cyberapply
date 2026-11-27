"""Observe receipt wording and a private email-code stage without reading codes."""
import re
from urllib.parse import urlsplit, urlunsplit, parse_qs, urlencode

RECEIVED = re.compile(r"\bwe(?: have|'ve|\u2019ve) (?:successfully )?received your application\b", re.I)


def receipt_match(text, legacy):
    return (legacy.search(text) if legacy else None) or RECEIVED.search(text)


def public_receipt_url(url):
    """Keep public vacancy identifiers only, never signed validity/auth queries."""
    p = urlsplit(url)
    query = parse_qs(p.query)
    public = {}
    if p.hostname in {'boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards.eu.greenhouse.io', 'job-boards.eu.greenhouse.io'} and p.path == '/embed/job_app/confirmation':
        board, job = query.get('for', []), query.get('token', [])
        if len(board) == len(job) == 1 and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', board[0]) and re.fullmatch(r'\d{1,30}', job[0]):
            public = {'for': board[0], 'token': job[0]}  # Greenhouse's public numeric vacancy ID.
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(public), ''))


EMAIL_CODE_STAGE = r"""() => {
 const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
 const code = [...document.querySelectorAll('input')].some(e => visible(e) && e.type !== 'hidden' && e.type !== 'password' && (e.autocomplete === 'one-time-code' || /^(?:code|otp|verification[_-]?code|security[_-]?code)$/i.test(e.name || e.id || '') || /(?:verification|security|email).{0,20}code/i.test(e.getAttribute('aria-label') || '')));
 const text = (document.body?.innerText || '').slice(0,12000);
 return code && /email|inbox/i.test(text) && /(?:enter|paste|type|sent|send|verify).{0,160}code|code.{0,100}(?:sent|email|inbox)/i.test(text);
}"""


def observed_email_verification(frames):
    for frame in frames[:20]:
        try:
            if frame.evaluate(EMAIL_CODE_STAGE) is True:
                return True
        except Exception:
            pass
    return False
