"""Bounded selections in labelled ARIA comboboxes, using visible offered options."""
import re
import time

from .profile_answers import place_key, profile_field


class DropdownAttention(Exception):
    def __init__(self, message, *, transient=False):
        super().__init__(message)
        self.transient=transient


def _text(value):
    return re.sub(r'\s+', ' ', str(value)).strip().casefold()


def _open_dropdown(control,timeout):
    """Opening/focusing is repeatable; ArrowDown never performs Submit/Enter."""
    if control.get_attribute('aria-expanded')=='true':return
    try:control.click(timeout=min(timeout,1000))
    except Exception as error:
        if type(error).__name__!='TimeoutError':raise
    if control.get_attribute('aria-expanded')!='true':
        control.press('ArrowDown',timeout=min(timeout,1000))


def option_matches(question, value, label, profile):
    if _text(value) == _text(label):
        return True
    key = profile_field(question)
    if key == 'country':
        # Phone-country menus append a calling code to the actual country name.
        country = re.sub(r'\s*\+\d[\d\s-]*$', '', label).strip()
        return place_key(country) == place_key(value)
    if key == 'city':
        parts = [part.strip() for part in label.split(',')]
        country = profile.get('country')
        state = profile.get('state')
        # Several cities can share a name within one country. The answer is
        # still the saved City; saved State only distinguishes offered places.
        if state and len(parts) >= 3 and _text(parts[-2]) != _text(state):
            return False
        return bool(len(parts) >= 2 and country and _text(parts[0]) == _text(value)
                    and place_key(parts[-1]) == place_key(country))
    return False


_DISPLAY = """e => {
 const texts=[];
 if(e.value) texts.push(e.value);
 for(let n=e,depth=0;n&&depth<3;n=n.parentElement,depth++) {
  if(n.querySelectorAll('[role=combobox]').length>1) break;
  const text=(n.innerText||'').replace(/\\s+/g,' ').trim();
  if(text) texts.push(text);
 }
 return texts;
}"""


def selected_display(control, label, frame=None):
    # A typed query alone is not a committed selection: require a separate
    # rendered display for input widgets, or the button/div's own display.
    if control.get_attribute('aria-expanded') != 'false' or control.get_attribute('aria-invalid') == 'true':
        return False
    texts = control.evaluate(_DISPLAY)
    if control.evaluate("e=>e.tagName==='INPUT'") and control.input_value():
        texts = texts[1:]
    if any(_text(text) == _text(label) for text in texts):return True
    # Greenhouse's phone-country widget renders only the calling code after
    # selection. A code alone is ambiguous (US and Canada both use +1).
    # Reopen its explicitly linked list and require the exact selected option.
    match=re.search(r'\s(\+\d[\d -]*)$',label)
    if (frame is None or control.get_attribute('id')!='country' or not match
            or not control.evaluate("e=>e.tagName==='INPUT'&&e.value===''")
            or not any(_text(text).replace(' ','')==match[1].replace(' ','') for text in texts)):
        return False
    valid=False
    try:
        _open_dropdown(control,750)
        popup=_popup(frame,control,750)
        _,choices=_options(popup)
        selected=popup.locator('[role="option"][aria-selected="true"]')
        valid=(sum(_text(text)==_text(label) for _,text in choices)==1 and selected.count()==1
               and selected.is_visible() and selected.is_enabled()
               and selected.get_attribute('aria-disabled')!='true' and _text(selected.inner_text())==_text(label))
    except Exception:valid=False
    finally:
        try:control.press('Escape',timeout=750)
        except Exception:pass
    return bool(valid and control.get_attribute('aria-expanded')=='false' and control.get_attribute('aria-invalid')!='true')


def has_unreviewed_selection(control):
    texts = control.evaluate(_DISPLAY)
    return any(_text(text) not in {'select', 'select...', 'select…', 'choose', 'choose...', 'choose…'} for text in texts)


def _popup(frame, control, timeout):
    refs = (control.get_attribute('aria-controls') or control.get_attribute('aria-owns') or '').split()
    deadline=time.monotonic()+timeout/1000
    while not refs and time.monotonic()<deadline:
        frame.wait_for_timeout(50)
        refs=(control.get_attribute('aria-controls') or control.get_attribute('aria-owns') or '').split()
    if len(refs) != 1 or not re.fullmatch(r'[\w.:-]{1,200}', refs[0]):
        raise DropdownAttention('This dropdown does not identify one supported option list. Complete it yourself.',transient=True)
    popup = frame.locator(f'[role="listbox"][id="{refs[0]}"]')
    popup.wait_for(state='visible', timeout=timeout)
    if popup.count() != 1:
        raise DropdownAttention('This dropdown has no unique linked option list. Complete it yourself.',transient=True)
    if popup.get_attribute('aria-multiselectable') == 'true':
        raise DropdownAttention('This dropdown allows multiple selections and needs review.')
    return popup


def _options(popup):
    controls = popup.locator('[role="option"]')
    if controls.count() > 512:
        raise DropdownAttention('This dropdown has too many options to match reliably.')
    choices = controls.evaluate_all("""items=>items.map((e,index)=>({index,label:(e.innerText||'').trim(),
      usable:!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[aria-hidden=true],[inert],[aria-disabled=true]')&&!e.matches(':disabled')
    })).filter(x=>x.usable&&x.label&&x.label.length<=1000).map(x=>[x.index,x.label])""")
    return controls, choices


def select_combobox(frame, control, field, value, profile, timeout=3000):
    """Click a unique exact/explicit-country match, then verify its display.

    Never press Enter, select the first suggestion, infer consent, write a hidden
    value, or inspect another dropdown's options. The caller supplies an answer
    already grounded in saved facts or an exact user confirmation.
    """
    timeout = min(timeout, 3000)
    def matching(choices):
        if not field.get('phoneCountry'):
            return [(index,label) for index,label in choices if option_matches(field['label'],value,label,profile)]
        candidates=[]
        for index,label in choices:
            code=re.search(r'\+(\d{1,4})$',label)
            if code and value.startswith('+'+code[1]):candidates.append((index,label,code[1]))
        if not candidates:return []
        longest=max(len(code) for _,_,code in candidates)
        candidates=[(index,label) for index,label,code in candidates if len(code)==longest]
        if len(candidates)>1:
            candidates=[(index,label) for index,label in candidates if option_matches('Country',profile.get('country',''),label,profile)]
        return candidates
    if control.get_attribute('aria-multiselectable') == 'true' or control.evaluate("e=>e.tagName==='BUTTON'&&e.type==='submit'"):
        raise DropdownAttention('This dropdown is not a supported single-choice control.')
    phase='opening the option list'
    try:
        _open_dropdown(control,timeout)
        editable=control.evaluate("e=>e.tagName==='INPUT'&&!e.readOnly")
        query=value
        if profile_field(field['label'])=='country':
            key=place_key(value)
            query={'uk':'United Kingdom','usa':'United States'}.get(key,key.title())
        phase='reading the linked option list'
        try:popup = _popup(frame, control, min(timeout,750))
        except Exception as error:
            # Search-only widgets do not create a menu until text is entered.
            # Use only the saved answer, never a guessed alternative location.
            if not editable or not (type(error).__name__=='TimeoutError' or isinstance(error,DropdownAttention) and error.transient):raise
            phase='searching the saved answer'
            control.fill(query,timeout=timeout)
            popup=_popup(frame,control,timeout)
        options, choices = _options(popup)
        matches = matching(choices)
        if not matches and editable and not field.get('phoneCountry'):
            phase='searching the saved answer'
            control.fill(query, timeout=timeout)
            deadline = time.monotonic() + timeout / 1000
            while True:
                popup = _popup(frame, control, timeout)
                options, choices = _options(popup)
                matches = matching(choices)
                if matches or time.monotonic() >= deadline:
                    break
                frame.wait_for_timeout(100)
        if len(matches) != 1:
            raise DropdownAttention('No unique offered option matches the saved answer. Choose the correct dropdown option yourself.')
        frame.wait_for_timeout(150)
        popup = _popup(frame, control, timeout)
        options, choices = _options(popup)
        matches = matching(choices)
        if len(matches) != 1 or popup.get_attribute('aria-busy') == 'true' or control.get_attribute('aria-busy') == 'true':
            raise DropdownAttention('The dropdown is still loading or its matching choices changed. Review this choice.',transient=True)
        index, label = matches[0]
        item = options.nth(index)
        if not item.is_visible() or not item.is_enabled() or item.get_attribute('aria-disabled') == 'true' or _text(item.inner_text()) != _text(label):
            raise DropdownAttention('The dropdown options changed before selection. Review this choice.',transient=True)
        phase='selecting the verified matching option'
        item.click(timeout=timeout)
        # React-style controls may commit their display asynchronously.
        phase='verifying the committed selection'
        deadline=time.monotonic()+min(timeout,750)/1000
        while not selected_display(control,label,frame) and time.monotonic()<deadline:
            frame.wait_for_timeout(50)
        if control.get_attribute('aria-expanded') == 'true':
            control.press('Escape', timeout=timeout)
        if not selected_display(control, label,frame):
            raise DropdownAttention('The dropdown did not confirm the selected answer. Review this choice.',transient=True)
        return label
    except DropdownAttention:
        raise
    except Exception:
        raise DropdownAttention(f'The dropdown could not be selected and verified reliably while {phase}. Review this choice.',transient=True) from None
    finally:
        # Escape cannot submit a form, unlike Enter on a focused search input.
        try:
            if control.count() == 1 and control.get_attribute('aria-expanded') == 'true':
                control.press('Escape', timeout=timeout)
        except Exception:
            pass
