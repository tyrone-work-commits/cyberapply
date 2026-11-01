"""Reuse explicit profile answers, never inferred personal facts or consent."""
import re
from decimal import Decimal,InvalidOperation

PROTECTED=re.compile(r'\b(?:consent|agree|accept|acknowledg|attest|certify|privacy|terms|permission|authori[sz]|visa|sponsor|citizen|nationality|right to work|salary|compensation|wage|clearance|criminal|convict|gender|race|ethnic|religion|disabil|veteran|birth|age|password|captcha|verification|security code)\w*\b',re.I)

def key(question):return re.sub(r'\s+',' ',str(question)).strip().casefold()

def automation_check(question,choices=()):
    return any(re.search(r"\b(?:are you (?:a |an )?(?:human|robot|bot)|i am (?:a |an )?(?:human|ai|robot|bot|automated program)|(?:verify|confirm|prove) (?:that )?you(?: are|'re) (?:a )?human|captcha)\b",str(text),re.I) for text in [question,*choices])

def remembered_answer(payload,question,field):
    if len(question.strip())<10 or PROTECTED.search(question) or field.get('type') in {'file','hidden','password'}:return None
    rows=(payload.get('applicantProfile') or {}).get('employerQuestions') or []
    matches=[r for r in rows[:40] if isinstance(r,dict) and key(r.get('question',''))==key(question) and r.get('source')=='user' and r.get('answer','').strip()]
    if len(matches)!=1:return None
    row=matches[0];value=row['answer'].strip();kind=field.get('type','text')
    if automation_check(question,[*(field.get('options') or []),*(row.get('options') or []),value]):return None
    if row.get('jobSpecific') and row.get('jobId')!=(payload.get('job') or {}).get('id'):return None
    if row.get('fieldType')!=kind:return None
    if kind in {'select','radio'} and value not in (field.get('options') or []):return None
    if kind=='checkbox':
        if value.casefold() not in {'yes','no','true','false'}:return None
        value='true' if value.casefold() in {'yes','true'} else 'false'
    if kind=='number':
        try:
            if not Decimal(value).is_finite():return None
        except InvalidOperation:return None
    return value,'Explicit answer saved in Account Profile for this exact question.'
