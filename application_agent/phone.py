"""Verify phone formatting against the saved international number, not new facts."""
import re


def country_option(profile, options):
    """Return an actual offered label. Shared calling codes need country evidence."""
    from .profile_answers import place_key
    country=place_key(profile.get('country',''))
    phone=str(profile.get('phone',''))
    candidates=[]
    for label in options:
        code=re.search(r'\+([0-9]{1,4})\s*\)?$',str(label))
        name=re.sub(r'\s*\(?\+[0-9]{1,4}\s*\)?$','',str(label)).strip()
        if code and phone.startswith('+'+code[1]):candidates.append((str(label),name,len(code[1])))
    if candidates:
        longest=max(size for _,_,size in candidates)
        matches=[label for label,name,size in candidates if size==longest and country and place_key(name)==country]
        if len(matches)==1:return matches[0]
        remaining=[label for label,_,size in candidates if size==longest]
        return remaining[0] if len(remaining)==1 else None
    matches=[str(label) for label in options if country and place_key(re.sub(r'\s*\(?\+[0-9]{1,4}\s*\)?$','',str(label)).strip())==country]
    return matches[0] if len(matches)==1 else None


def equivalent_phone(expected,actual,calling_code=''):
    clean=lambda value:re.sub(r'[\s().-]','',str(value))
    expected,actual,calling_code=map(clean,(expected,actual,calling_code))
    if not re.fullmatch(r'\+[1-9][0-9]{7,14}',expected):return False
    if calling_code and (not re.fullmatch(r'\+[1-9][0-9]{0,3}',calling_code) or not expected.startswith(calling_code)):return False
    if actual==expected:return True
    if not calling_code or not re.fullmatch(r'[0-9]+',actual):return False
    national=expected[len(calling_code):]
    # National display may include a trunk zero; never remove a zero actually
    # present in the saved E.164 national number (e.g. Italian landlines).
    return actual==national or actual==expected[1:] or (not national.startswith('0') and actual=='0'+national)


def matches_phone(control,expected):
    info=control.evaluate("""e=>{const group=e.closest('fieldset.phone-input');
      const country=group?.querySelector('[role=combobox]#country');
      const code=country?.closest('.select__value-container')?.innerText||'';
      return {actual:e.value,code:country&&country.getAttribute('aria-expanded')==='false'&&country.getAttribute('aria-invalid')!=='true'?code.trim():''};}""")
    return equivalent_phone(expected,info['actual'],info['code'])
