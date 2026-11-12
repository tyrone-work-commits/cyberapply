"""Capture linked choices during the authorized form run, before planning answers."""
import re

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
