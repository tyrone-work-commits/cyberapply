"""Reuse explicit profile answers, never inferred personal facts or consent."""
import re
from decimal import Decimal,InvalidOperation



def key(question):return re.sub(r'\s+',' ',str(question)).strip().casefold()

def automation_check(question,choices=()):
    return any(re.search(r"\b(?:are you (?:a |an )?(?:human|robot|bot)|i am (?:a |an )?(?:human|ai|robot|bot|automated program)|(?:verify|confirm|prove) (?:that )?you(?: are|'re) (?:a )?human|captcha)\b",str(text),re.I) for text in [question,*choices])

def remembered_answer(payload,question,field):
    if not question.strip() or re.search(r'\b(?:consent|agree|accept|acknowledg|attest|certify|privacy|terms|permission|password|captcha|verification|security code)\w*\b',question,re.I) or re.search(r'\bauthori[sz]\w*\b.*\b(?:process|store|share|collect|retain|contact|personal data)\b',question,re.I) or field.get('type') in {'file','hidden','password'}:return None
    rows=(payload.get('applicantProfile') or {}).get('employerQuestions') or []
    matches=[r for r in rows if isinstance(r,dict) and key(r.get('question',''))==key(question) and r.get('source')=='user' and r.get('fieldType')==field.get('type','text') and r.get('answer','').strip() and (not (r.get('jobSpecific') or r.get('reusePolicy')=='job_only') or r.get('jobId')==(payload.get('job') or {}).get('id'))]
    if len(matches)!=1:return None
    row=matches[0];value=row['answer'].strip();kind=field.get('type','text')
    if automation_check(question,[*(field.get('options') or []),*(row.get('options') or []),value]):return None
    if row.get('reusePolicy')=='manual_only':return None
    scoped=row.get('jobSpecific') or row.get('reusePolicy')=='job_only' or re.search(r'\b(?:salary|compensation|remuneration|wage|pay|this (?:role|position|job|company|country)|country (?:in )?which|country.*(?:applying|posted))\b',question,re.I)
    if scoped and row.get('jobId')!=(payload.get('job') or {}).get('id'):return None
    if row.get('fieldType')!=kind:return None
    if kind in {'select','radio'}:
        choices=[str(option) for option in field.get('options') or [] if key(option)==key(value)]
        if len(choices)!=1:return None
        value=choices[0]
    if kind=='checkbox':
        if value.casefold() not in {'yes','no','true','false'}:return None
        value='true' if value.casefold() in {'yes','true'} else 'false'
    if kind=='number':
        try:
            if not Decimal(value).is_finite():return None
        except InvalidOperation:return None
    return value,'Explicit answer saved in Account Profile for this exact question.'
