"""Capture linked choices during the authorized form run, before planning answers."""
import re
import json
import time

from .combobox import capture_combobox_options
from .profile_answers import profile_field
from .choice_matching import place_key


def choice_limit(question):
    return 400 if re.fullmatch(r'(?:country|(?:location\s*\(?\s*)?city\)?|location)\s*\*?', str(question).strip(), re.I) else 100


def capture_application_choices(frame, control, field, profile, timeout=1500):
    """Read a menu; search-only location menus use exact saved profile facts.

    This never chooses an option or presses Enter/Continue/Submit. The existing
    answer planner and verified-selection checks still decide whether to fill it.
    """
    limit = choice_limit(field.get('label', ''))
    choices = field.get('options') or capture_combobox_options(frame, control, timeout, limit)
    key = profile_field(field.get('label', ''))
    query = profile.get(key, '') if key in {'city', 'country'} and not field.get('phoneCountry') else ''
    if not choices and isinstance(query, str) and 1 < len(query.strip()) <= 120 and not re.search(r'[\x00-\x1f]', query):
        query = query.strip()
        if key == 'country':
            country = place_key(query)
            query = {'uk': 'United Kingdom', 'usa': 'United States'}.get(country, country.title())
        try:
            if control.evaluate("e=>e.tagName==='INPUT'&&!e.readOnly&&!e.disabled"):
                control.fill(query, timeout=min(timeout, 2500))
                choices = capture_combobox_options(frame, control, timeout, limit)
        except Exception:
            # A failed lookup remains an ordinary unresolved widget, not a guess.
            choices = []
    labels = [re.sub(r'\s+', ' ', str(value)).strip()[:200] for value in choices if str(value).strip()]
    return labels[:limit], bool(field.get('optionsTruncated')) or len(labels) > limit


def refresh_missing_choices(frames, controls, fields, report, profile, budget_ms=6000):
    """Late metadata-only pass, after dependencies/phone widgets initialize.

    Never replay a selection, upload, navigation or submission. Keep a successful
    catalog even if another inspection is empty. A replaced input is accepted
    only by its unique original DOM id, matching label and combobox role.
    """
    deadline = time.monotonic() + min(6000, max(0, budget_ms)) / 1000
    for field in fields:
        if field.get('type') != 'combobox' or field.get('options'):
            continue
        frame = frames[int(field['id'].split(':', 1)[0])]
        control = controls[field['id']]
        for attempt in range(2):
            remaining = int((deadline - time.monotonic()) * 1000)
            if remaining < 100:
                return
            try:
                if control.count() != 1 and field.get('domId'):
                    candidate = frame.locator('[id=' + json.dumps(field['domId']) + ']')
                    if candidate.count() != 1 or candidate.get_attribute('role') != 'combobox':
                        break
                    label = candidate.evaluate("e=>[...(e.labels||[])].map(x=>x.textContent).join(' ')||e.getAttribute('aria-label')||''")
                    normal = lambda value: re.sub(r'[\s*]+', ' ', str(value)).strip().casefold()
                    if normal(label) != normal(field['label']):
                        break
                    control = candidate
                choices, truncated = capture_application_choices(frame, control, field, {}, min(1200, remaining))
                if choices:
                    field.update(options=choices, optionsTruncated=truncated)
                    for row in report.get('questions', []):
                        if row.get('question') == field['label'] and row.get('field_type') == 'combobox':
                            row.update(options=choices, optionsTruncated=truncated)
                    break
                if not attempt:
                    frame.wait_for_timeout(min(150, max(0, int((deadline-time.monotonic())*1000))))
            except Exception:
                # Missing menu metadata is a technical issue, never a new fact.
                continue
