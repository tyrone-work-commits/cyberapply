"""Boolean-only recording gate: never export page text or verification values."""
PRIVATE_PAGE = r"""() => {
 const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
 const inputs = [...document.querySelectorAll('input')].filter(visible);
 if (inputs.some(e => e.type === 'password' || e.autocomplete === 'one-time-code' || /^(?:code|otp|verification[_-]?code|security[_-]?code)$/i.test(e.name || e.id || ''))) return true;
 if ([...document.querySelectorAll('iframe[src*="/recaptcha/"][src*="/bframe"]')].some(visible)) return true;
 if (document.activeElement?.matches('iframe[src*="recaptcha"],iframe[src*="captcha"]')) return true;
 const text = (document.body?.innerText || '').slice(0,12000);
 return inputs.length > 0 && /(?:enter|paste|type).{0,100}(?:(?:verification|security|one.time|8.character|email).{0,30}code|code.{0,80}(?:confirm|verify|human))|(?:confirm|verify).{0,60}(?:email|human).{0,100}code/i.test(text);
}"""

def private_media_page(page):
 try:
  if page.is_closed() or len(page.frames)>20:return True
  for frame in page.frames:
   # Badge/anchor frames are not themselves an image challenge; the parent
   # detects focus or a visible challenge. Never read their contents.
   from .employer_verification import recaptcha_resource
   if recaptcha_resource(frame.url):continue
   if frame.evaluate(PRIVATE_PAGE):return True
  return False
 except Exception:return True  # Navigation/inspection failure stops capture.
