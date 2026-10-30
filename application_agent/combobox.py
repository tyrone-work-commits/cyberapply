"""Bounded selections in labelled ARIA comboboxes, using visible offered options."""
import re
import time

from .profile_answers import place_key, profile_field


class DropdownAttention(Exception):
    pass


def _text(value):
    return re.sub(r'\s+', ' ', str(value)).strip().casefold()


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


def selected_display(control, label):
    # A typed query alone is not a committed selection: require a separate
    # rendered display for input widgets, or the button/div's own display.
    if control.get_attribute('aria-expanded') != 'false' or control.get_attribute('aria-invalid') == 'true':
        return False
    texts = control.evaluate(_DISPLAY)
    if control.evaluate("e=>e.tagName==='INPUT'") and control.input_value():
        texts = texts[1:]
    return any(_text(text) == _text(label) for text in texts)


def has_unreviewed_selection(control):
    texts = control.evaluate(_DISPLAY)
    return any(_text(text) not in {'select', 'select...', 'select…', 'choose', 'choose...', 'choose…'} for text in texts)


def _popup(frame, control, timeout):
    refs = (control.get_attribute('aria-controls') or control.get_attribute('aria-owns') or '').split()
    if len(refs) != 1 or not re.fullmatch(r'[\w.:-]{1,200}', refs[0]):
        raise DropdownAttention('This dropdown does not identify one supported option list. Complete it yourself.')
    popup = frame.locator(f'[role="listbox"][id="{refs[0]}"]')
    popup.wait_for(state='visible', timeout=timeout)
    if popup.count() != 1:
        raise DropdownAttention('This dropdown has no unique linked option list. Complete it yourself.')
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
    if control.get_attribute('aria-multiselectable') == 'true' or control.evaluate("e=>e.tagName==='BUTTON'&&e.type==='submit'"):
        raise DropdownAttention('This dropdown is not a supported single-choice control.')
    try:
        control.click(timeout=timeout)
        popup = _popup(frame, control, timeout)
        options, choices = _options(popup)
        matches = [(index, label) for index, label in choices if option_matches(field['label'], value, label, profile)]
        if not matches and control.evaluate("e=>e.tagName==='INPUT'&&!e.readOnly"):
            query = value
            if profile_field(field['label']) == 'country':
                key = place_key(value)
                query = {'uk':'United Kingdom','usa':'United States'}.get(key, key.title())
            control.fill(query, timeout=timeout)
            deadline = time.monotonic() + timeout / 1000
            while True:
                popup = _popup(frame, control, timeout)
                options, choices = _options(popup)
                matches = [(index, label) for index, label in choices if option_matches(field['label'], value, label, profile)]
                if matches or time.monotonic() >= deadline:
                    break
                frame.wait_for_timeout(100)
        if len(matches) != 1:
            raise DropdownAttention('No unique offered option matches the saved answer. Choose the correct dropdown option yourself.')
        frame.wait_for_timeout(150)
        popup = _popup(frame, control, timeout)
        options, choices = _options(popup)
        matches = [(index, label) for index, label in choices if option_matches(field['label'], value, label, profile)]
        if len(matches) != 1 or popup.get_attribute('aria-busy') == 'true' or control.get_attribute('aria-busy') == 'true':
            raise DropdownAttention('The dropdown is still loading or its matching choices changed. Review this choice.')
        index, label = matches[0]
        item = options.nth(index)
        if not item.is_visible() or not item.is_enabled() or item.get_attribute('aria-disabled') == 'true' or _text(item.inner_text()) != _text(label):
            raise DropdownAttention('The dropdown options changed before selection. Review this choice.')
        item.click(timeout=timeout)
        if control.get_attribute('aria-expanded') == 'true':
            control.press('Escape', timeout=timeout)
        if not selected_display(control, label):
            raise DropdownAttention('The dropdown did not confirm the selected answer. Review this choice.')
        return label
    except DropdownAttention:
        raise
    except Exception:
        raise DropdownAttention('The dropdown could not be selected and verified reliably. Review this choice.') from None
    finally:
        # Escape cannot submit a form, unlike Enter on a focused search input.
        try:
            if control.count() == 1 and control.get_attribute('aria-expanded') == 'true':
                control.press('Escape', timeout=timeout)
        except Exception:
            pass
