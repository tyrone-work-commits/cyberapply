"""Applicant contact and salary answers come exclusively from saved Edit Profile."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re

_COUNTRY_ALIASES={
 'uk':{'uk','u k','united kingdom','gb','gbr'},
 'ireland':{'ireland','republic of ireland','ie','irl'},
 'usa':{'usa','us','u s','u s a','united states','united states of america'},
 'canada':{'canada','ca','can'},'nigeria':{'nigeria','ng','nga'},
 'germany':{'germany','deutschland'},'australia':{'australia'},'france':{'france'},'netherlands':{'netherlands','the netherlands'},
 'india':{'india'},'south africa':{'south africa'},'new zealand':{'new zealand'},'singapore':{'singapore'},
}
def place_key(value):
    text=re.sub(r'[^\w\s-]',' ',str(value).casefold())
    text=re.sub(r'\s+',' ',text).strip()
    text=re.sub(r'^the\s+','',text)
    return next((country for country,aliases in _COUNTRY_ALIASES.items() if text in aliases),text)

def location_question(question):
    text=re.sub(r'\s+',' ',question.casefold()).strip(' *:?!')
    match=re.fullmatch(r'(?:are you (?:currently )?(?:located|based|living|resident)|do you (?:currently )?(?:live|reside)) in (.+)',text)
    if not match:return None
    target=match[1]
    if re.search(r'\b(?:not|outside|within|distance|willing|relocat|commut|authori|visa|sponsor|eligible|work|why|explain|describe)\w*\b',target):return []
    parts=[part.strip() for part in re.split(r'\s+or\s+|\s*,\s*|\s*/\s*',target) if part.strip()]
    if ' and ' in target or not parts or any(len(part)>80 for part in parts):return []
    return parts

def residence_answer(profile,question):
    targets=location_question(question)
    if not targets:return None,'','This residence question is conditional or ambiguous. Review it yourself.'
    if any(target.strip().casefold() in {'ca','ie','ng'} for target in targets):return None,'','The place abbreviation is ambiguous in this residence question. Review the full place name.'
    country=profile.get('country','');city=profile.get('city','');location=profile.get('location','')
    saved={place_key(value) for value in [country,city,*re.split(r'[,;]',location)] if isinstance(value,str) and value.strip()}
    uk_parts={'england','scotland','wales','northern ireland'}
    if saved.intersection(uk_parts):saved.add('uk')
    explicit_location=[value for value in re.split(r'[,;]',location) if len(value.strip())>3 or value.strip().casefold() in {'uk','us','usa'}]
    country_evidence={place_key(value) for value in [country,*explicit_location] if isinstance(value,str) and place_key(value) in _COUNTRY_ALIASES}
    if len(country_evidence)>1:return None,'','Country and location disagree in Edit Profile. Correct them before answering this question.'
    if not saved:return None,'','Add your country, city or location in Edit Profile before answering residence questions.'
    keys=[place_key(target) for target in targets]
    if all(key in _COUNTRY_ALIASES for key in keys):
        if country and place_key(country) in uk_parts:country_evidence.add('uk')
        if not country_evidence:return None,'','Add an explicit country in Edit Profile. A city alone does not establish country residence.'
        value='Yes' if country_evidence.intersection(keys) else 'No'
    elif any(key in saved for key in keys):value='Yes'
    elif any(key in uk_parts for key in keys):return None,'','Your profile does not establish which part of the United Kingdom matches this question.'
    elif len(keys)==1 and city and not re.search(r'[()]|\b(?:area|region|state|province|county|district|borough|metro|metropolitan|britain|europe|america|emea|apac)\b',targets[0]):
        if place_key(country) in keys:return None,'','Confirm this location in Edit Profile.'
        value='No'
    else:return None,'','The saved location cannot establish this geographic area. Review the question yourself.'
    return value,f'Edit Profile residence comparison — country: {country}; city: {city}; location: {location}. Matched against the question, without inferring work permission.',''


def profile_field(question):
    text=re.sub(r'\s+',' ',question.casefold().replace('_',' ').replace('zip-code','zip code')).strip(' *:?!')
    visa=bool(re.search(r'\b(?:visa|sponsor\w*)\b',text))
    rights=bool(re.search(r'right to work|(?:legally able|(?:legally )?(?:authori[sz]ed|eligible|permitted|entitled|allowed)) to work|work authori[sz]ation',text))
    if visa or rights:
        countries=[key for key,pattern in {'uk':r'\b(?:uk|u\.k\.?|united kingdom|great britain)\b','usa':r'\b(?:usa|u\.s\.?a?\.?|united states(?: of america)?)\b|\b(?:in|for|within|the) us\b','canada':r'\bcanada\b','ireland':r'\b(?:ireland|republic of ireland)\b'}.items() if re.search(pattern,text)]
        if 'usa' not in countries and re.search(r'\bUS\b',question):countries.append('usa')
        if re.search(r'\bnorthern ireland\b',text):return 'eligibilityReview'
        if not countries:return None
        if visa and not re.search(r'\b(?:need|requir)\w*\b',text):return 'eligibilityReview'
        if rights and not visa and set(countries)=={'uk','ireland'}:
            country=r'(?:the )?(?:uk|u\.k\.?|united kingdom|great britain|(?:republic of )?ireland)'
            pattern=rf'(?:are you (?:legally )?(?:authori[sz]ed|eligible|permitted|entitled|allowed) to work|do you (?:currently )?have (?:the )?right to work) in {country} or {country}(?: for any employer)?'
            if re.fullmatch(pattern,text):return 'ukIrelandRightToWork'
            return 'eligibilityReview'
        if len(countries)!=1 or (visa and rights) or re.search(r'\b(?:not|without|citizen|citizenship|permanent resident|why|explain|describe)\b',text):return 'eligibilityReview'
        return countries[0]+('RightToWork' if rights else 'VisaRequired')
    if re.search(r'\b(?:salary|compensation|remuneration|wage|pay expectations?|expected pay|pay rate|desired pay)\b',text):
        return 'expectedSalary'
    if location_question(question) is not None:return 'residenceQuestion'
    if text in {'where are you located','where do you live','where do you reside'}:return 'location'
    if re.search(r'\b(?:employer|company|reference|referee|emergency|nationality|citizenship|birth|relocat|willing)\b',text):return None
    text=re.sub(r'^(?:what is |please (?:provide|enter) )', '', text).strip()
    text=re.sub(r"^(?:your |applicant(?:'s)? |candidate(?:'s)? |current |home |residential |contact |primary |permanent |mailing )+", '',text)
    if text in {'name','full name','legal name','first and last name','first name','last name','given name','family name','surname','preferred first name','preferred name','first name(s)','given name(s)','firstname','lastname','fullname'} or re.fullmatch(r'(?:legal |preferred )?(?:first|last|given|family|full) name(?: \(legal\))?',text):return 'fullName'
    if re.fullmatch(r'(?:zip|zip code|zipcode|postal|postal code|postcode|post code)(?: / postal code)?',text):return 'zipCode'
    if re.fullmatch(r'(?:street |mailing |residential |home |full )?address(?: line 1| 1)?',text):return 'address'
    if text in {'city','town','city / town','city/town','city or town','location (city)','location(city)','city / location','city/location'}:return 'city'
    if text in {'country','country of residence','country of residency','country where you reside'}:return 'country'
    if text in {'location','where are you located','where do you live','where do you reside','city and country','city, country'}:return 'location'
    if re.fullmatch(r'(?:phone|telephone|mobile|cell|cellphone)(?: phone)?(?: number| no\.?)?(?: \((?:including|with) (?:country|international) code\))?',text):return 'phone'
    return None


def saved_profile_answer(payload,question,field):
    """Return value/evidence/reason. Never reinterpret expectation as salary history."""
    key=profile_field(question)
    profile=payload.get('applicantProfile')
    profile=profile if isinstance(profile,dict) else {}
    if key=='residenceQuestion':return residence_answer(profile,question)
    if key=='ukIrelandRightToWork':
        values=[profile.get('ukRightToWork'),profile.get('irelandRightToWork')]
        if any(value is True for value in values):value='Yes'
        elif all(value is False for value in values):value='No'
        else:return None,'','Choose current right to work for the UK and Ireland in Edit Profile. No is only established when both are No; residence and visa answers do not establish permission.'
        proof='Edit Profile — UK current right to work: '+str(values[0])+'; Ireland current right to work: '+str(values[1])+'. Either-country authorization question; no eligibility inferred from residence or visa requirements.'
        return value,proof,''
    if key and key.endswith(('VisaRequired','RightToWork')):
        value=profile.get(key)
        if not isinstance(value,bool):return None,'',f'Choose Yes or No for {key} in Edit Profile. Visa requirement and current right to work are separate facts.'
        return ('Yes' if value else 'No'),f'Edit Profile — {key}: {"Yes" if value else "No"}. No eligibility inferred from location or visa status.',''
    if key=='eligibilityReview':return None,'','This eligibility question combines countries, conditions or negative wording that the saved choices cannot establish. Review it yourself; no right to work is inferred.'
    if key!='expectedSalary':
        value=profile.get(key)
        if not isinstance(value,str) or not value.strip():
            return None,'',f'Add {key or "this detail"} in Edit Profile before applying. No CV or generated replacement is used.'
        value=value.strip()
        if key=='phone' and not re.fullmatch(r'\+[1-9]\d{7,14}',value):
            return None,'','Save an international phone number in Edit Profile.'
        return value,f'Edit Profile — {key}: {value}',''
    if re.search(r'\b(?:current|present|previous|last|past|earned|earning|minimum|lowest|history)\b',question,re.I):
        return None,'','Edit Profile stores expected salary, not current/past salary or a minimum. Supply the matching fact; the agent will not invent it.'
    salary=profile.get('expectedSalary')
    try:
        if not isinstance(salary,dict) or isinstance(salary.get('amount'),bool):raise ValueError()
        amount=Decimal(str(salary['amount']))
        currency,period=salary['currency'],salary['period']
        if not amount.is_finite() or not 0<amount<=10**12 or currency!='USD' or period not in {'month','year'}:raise ValueError()
    except (KeyError,ValueError,TypeError,InvalidOperation):
        return None,'','Enter your expected salary in USD and its monthly/yearly pay period in Edit Profile. Salary research and guesses are disabled.'
    target_period='year' if re.search(r'\b(?:annual\w*|year\w*|per annum)\b',question,re.I) else 'month' if re.search(r'\bmonth\w*\b',question,re.I) else None
    if re.search(r'\b(?:hour\w*|week\w*|day|daily)\b',question,re.I):
        return None,'','The form requests an hourly/daily/weekly amount. Your profile only specifies monthly/yearly salary; working hours or days cannot be assumed.'
    currencies=set(re.findall(r'\b(?:USD|GBP|EUR|NGN|CAD|AUD|ZAR|INR|KES|GHS|AED|SGD|CHF|NZD|JPY)\b',question.upper()))
    if re.search(r'US\$|\bU\.?S\.? dollars?\b',question,re.I):currencies.add('USD')
    if re.search(r'£|pounds?',question,re.I):currencies.add('GBP')
    if '€' in question:currencies.add('EUR')
    if '₦' in question:currencies.add('NGN')
    if re.search(r'canadian dollars?|C\$',question,re.I):currencies.add('CAD')
    if re.search(r'australian dollars?|A\$',question,re.I):currencies.add('AUD')
    for code,pattern in {'NGN':r'\bnaira\b','EUR':r'\beuros?\b','JPY':r'\byen\b','ZAR':r'\brand\b','INR':r'\b(?:indian )?rupees?\b','AED':r'\bdirhams?\b','GHS':r'\bcedis?\b','KES':r'\b(?:kenyan )?shillings?\b','CHF':r'\bswiss francs?\b','NZD':r'\bnew zealand dollars?\b','SGD':r'\bsingapore dollars?\b'}.items():
        if re.search(pattern,question,re.I):currencies.add(code)
    if currencies and currencies!={'USD'}:
        return None,'','This salary field requests another or ambiguous currency. No exchange rate is assumed; your saved expectation is USD.'
    numeric=field.get('type')=='number' or field.get('numeric') is True
    if numeric and (not target_period or currencies!={'USD'}):
        return None,'','A numeric salary field must specify USD and monthly/yearly units. The agent will not guess its currency or pay period.'
    original=amount
    if target_period and target_period!=period:amount=amount*12 if target_period=='year' else amount/12
    target_period=target_period or period
    result=format(amount.quantize(Decimal('0.01'),rounding=ROUND_HALF_UP),'f').rstrip('0').rstrip('.')
    proof=f'Edit Profile — expectedSalary: USD {original} per {period}. Answer: USD {result} per {target_period}; 12 months per year, rounded to cents. No market salary generated.'
    return (result if numeric else f'USD {result} per {target_period}'),proof,''
