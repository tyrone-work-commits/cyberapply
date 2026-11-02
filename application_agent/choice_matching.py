"""Resolve one offered choice from an established answer, never by similarity."""
import re
from decimal import Decimal, InvalidOperation

from .profile_answers import place_key, profile_field


def text_key(value):
    return re.sub(r'\s+', ' ', str(value)).strip().casefold()


_US_STATES = dict(pair.split(':') for pair in (
    'al:alabama|ak:alaska|az:arizona|ar:arkansas|ca:california|co:colorado|'
    'ct:connecticut|de:delaware|dc:district of columbia|fl:florida|ga:georgia|'
    'hi:hawaii|id:idaho|il:illinois|in:indiana|ia:iowa|ks:kansas|ky:kentucky|'
    'la:louisiana|me:maine|md:maryland|ma:massachusetts|mi:michigan|mn:minnesota|'
    'ms:mississippi|mo:missouri|mt:montana|ne:nebraska|nv:nevada|nh:new hampshire|'
    'nj:new jersey|nm:new mexico|ny:new york|nc:north carolina|nd:north dakota|'
    'oh:ohio|ok:oklahoma|or:oregon|pa:pennsylvania|ri:rhode island|'
    'sc:south carolina|sd:south dakota|tn:tennessee|tx:texas|ut:utah|vt:vermont|'
    'va:virginia|wa:washington|wv:west virginia|wi:wisconsin|wy:wyoming'
).split('|'))


def state_key(value, country):
    value = text_key(value)
    return _US_STATES.get(value, value) if place_key(country) == 'usa' else value


def option_matches(question, value, label, profile, *, years=False):
    if text_key(value) == text_key(label):
        return True
    # Punctuation on a bare Yes/No adds no new condition. Longer statements
    # ("Yes, but only with sponsorship") must not inherit that meaning.
    if text_key(value) in {'yes', 'no'} and text_key(label).rstrip('.!') == text_key(value):
        return True
    key = profile_field(question)
    if key == 'country':
        country = re.sub(r'\s*\+\d[\d\s-]*$', '', label).strip()
        return place_key(country) == place_key(value)
    if key == 'state':
        return state_key(label, profile.get('country', '')) == state_key(value, profile.get('country', ''))
    if key == 'city':
        parts = [part.strip() for part in label.split(',')]
        country, state = profile.get('country'), profile.get('state')
        if len(parts) not in {2, 3} or not country or text_key(parts[0]) != text_key(value):
            return False
        if place_key(parts[-1]) != place_key(country):
            return False
        return not (state and len(parts) == 3 and state_key(parts[1], country) != state_key(state, country))
    if years:
        try:
            amount = Decimal(str(value))
            if not amount.is_finite() or amount < 0:
                return False
        except InvalidOperation:
            return False
        label = text_key(label).replace('–', '-').replace('—', '-')
        if match := re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)(?:\s+years?)?', label):
            return Decimal(match[1]) <= amount <= Decimal(match[2])
        if match := re.fullmatch(r'(\d+(?:\.\d+)?)(?:\s+years?)?', label):
            return amount == Decimal(match[1])
        if match := re.fullmatch(r'(\d+(?:\.\d+)?)\s*\+(?:\s+years?)?', label):
            return amount >= Decimal(match[1])
        if match := re.fullmatch(r'(?:less than|under)\s+(\d+(?:\.\d+)?)(?:\s+years?)?', label):
            return amount < Decimal(match[1])
    return False


def unique_option(question, value, options, profile, *, years=False):
    """Ambiguous/duplicate options and placeholder labels never select first."""
    matches = [str(label) for label in options if str(label).strip() and
               option_matches(question, value, str(label), profile, years=years)]
    return matches[0] if len(matches) == 1 else None
