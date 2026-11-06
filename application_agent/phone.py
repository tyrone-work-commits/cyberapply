"""Verify phone formatting against the saved international number, not new facts."""
import re


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
