"""Exact, explicitly chosen labels in native/linked ARIA multi-selects."""
import json
import time
from .combobox import DropdownAttention,_open_dropdown,_popup,_options

def parse_multiple(value,options):
    try:values=json.loads(value)
    except (ValueError,TypeError):values=[value] if value in options else None
    if not isinstance(values,list) or len(values)>100 or any(not isinstance(v,str) or options.count(v)!=1 for v in values) or len(set(values))!=len(values):return None
    return [option for option in options if option in values]

def _scope(control):
    node=control;last=control
    for _ in range(4):
        node=node.locator('xpath=..')
        if node.locator('[role=combobox]').count()!=1:break
        last=node
        if node.locator('[class*="multi-value__label"],[class*="multiValueLabel"]').count():return node
    return last

def _selected(frame,control):
    if control.evaluate("e=>e.tagName==='SELECT'"):
        if not control.evaluate('e=>e.multiple'):raise DropdownAttention('The employer changed this multi-select to a single-choice field.')
        return control.evaluate('e=>[...e.selectedOptions].map(o=>o.text)')
    chips=_scope(control).locator('[class*="multi-value__label"],[class*="multiValueLabel"]')
    if chips.count():return chips.all_inner_texts()
    _open_dropdown(control,750);popup=_popup(frame,control,750,allow_multiple=True)
    if popup.get_attribute('aria-multiselectable')!='true':raise DropdownAttention('The employer menu does not confirm multiple selection.')
    return popup.locator('[role=option][aria-selected=true]').all_inner_texts()

def selected_multiple(frame,control,expected):
    try:
        values=_selected(frame,control)
        return len(values)==len(expected) and set(values)==set(expected)
    except Exception:return False
    finally:
        try:
            if control.get_attribute('aria-expanded')=='true':control.press('Escape',timeout=750)
        except Exception:pass

def select_multiple(frame,control,field,value,timeout=3000):
    desired=parse_multiple(value,field.get('options') or [])
    if desired is None or field.get('required') and not desired:raise DropdownAttention('Select valid offered choices for this multiple-choice question.')
    if selected_multiple(frame,control,desired):return desired
    if control.evaluate("e=>e.tagName==='SELECT'"):
        choices=control.locator('option').evaluate_all("nodes=>nodes.filter(e=>!e.disabled&&!e.closest('optgroup[disabled]')).map(e=>e.text)")
        if any(choices.count(v)!=1 for v in desired):raise DropdownAttention('A chosen employer option is disabled, missing or ambiguous.')
        control.select_option(label=desired,timeout=timeout)
    else:
        try:
            current=_selected(frame,control);control.press('Escape',timeout=750)
            for label in current:
                if label in desired:continue
                remove=_scope(control).get_by_label('Remove '+label,exact=True)
                if remove.count()!=1 or not remove.is_visible():raise DropdownAttention('The existing multi-select choice cannot be cleared reliably. Review this control.')
                remove.click(timeout=timeout)
            for label in desired:
                if label in _selected(frame,control):
                    control.press('Escape',timeout=750);continue
                _open_dropdown(control,timeout);popup=_popup(frame,control,timeout,allow_multiple=True)
                if popup.get_attribute('aria-multiselectable')!='true':raise DropdownAttention('The employer menu is not a multi-select.')
                options,choices=_options(popup);matches=[i for i,text in choices if text==label]
                if not matches and control.evaluate("e=>e.tagName==='INPUT'&&!e.readOnly"):
                    control.fill(label,timeout=timeout);frame.wait_for_timeout(150);popup=_popup(frame,control,timeout,allow_multiple=True);options,choices=_options(popup);matches=[i for i,text in choices if text==label]
                if len(matches)!=1:raise DropdownAttention('No unique enabled employer option matches the saved multi-select choice.')
                options.nth(matches[0]).click(timeout=timeout);control.press('Escape',timeout=750)
        except DropdownAttention:raise
        except Exception:raise DropdownAttention('The multi-select could not be filled and verified; no submission was attempted.') from None
    deadline=time.monotonic()+min(timeout,1000)/1000
    while time.monotonic()<deadline:
        if selected_multiple(frame,control,desired):return desired
        frame.wait_for_timeout(50)
    raise DropdownAttention('The employer multi-select did not retain all chosen options. Review its control before continuing.')
