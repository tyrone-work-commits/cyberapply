"""Reuse explicit profile answers, never inferred personal facts or consent."""
import re
from decimal import Decimal,InvalidOperation



def key(question):return re.sub(r'\s+',' ',str(question)).strip().rstrip(' *').casefold()

def automation_check(question,choices=()):
    return any(re.search(r"\b(?:are you (?:a |an )?(?:human|robot|bot)|i am (?:a |an )?(?:human|ai|robot|bot|automated program)|(?:verify|confirm|prove) (?:that )?you(?: are|'re) (?:a )?human|captcha)\b",str(text),re.I) for text in [question,*choices])

def authorship_check(question):
    text=re.sub(r'\s+',' ',str(question))
    certification=re.search(r"\b(?:confirm|certify|attest|declare|acknowledge)\b.{0,100}\b(?:AI|ChatGPT|own words|original work|independently written)\b",text,re.I)
    direct=re.search(r"^(?:(?:did|have) you (?:ever )?(?:use|used)\b|(?:was|were|is|are) (?:any of )?(?:your|this|the|these|all) (?:application|answers?|responses?|submission|cover.?letter)\b)",text,re.I)
    return bool(certification or direct and re.search(r'\b(?:AI|ChatGPT)\b',text,re.I) and re.search(r'\b(?:application|answers?|responses?|submission|cover.?letter)\b',text,re.I))

def remembered_answer(payload,question,field):
    if authorship_check(question) or not question.strip() or re.search(r'\b(?:consent|agree|accept|acknowledg|attest|certify|privacy|terms|permission|password|captcha|verification|security code)\w*\b',question,re.I) or re.search(r'\bauthori[sz]\w*\b.*\b(?:process|store|share|collect|retain|contact|personal data)\b',question,re.I) or field.get('type') in {'file','hidden','password'}:return None
    rows=(payload.get('applicantProfile') or {}).get('employerQuestions') or []
    kind=field.get('type','text')
    def group(control):return 'choice' if control in {'select','radio','combobox','checkbox'} else 'text' if control in {'text','textarea'} else control
    # Legacy job_only user edits are reusable too; a new employer does not discard them.
    matches=[r for r in rows if isinstance(r,dict) and key(r.get('question',''))==key(question) and r.get('source')=='user' and group(r.get('fieldType'))==group(kind)]
    if not matches:return None
    latest=max(str(row.get('updatedAt','')) for row in matches)
    matches=[row for row in matches if str(row.get('updatedAt',''))==latest]
    # Never guess between conflicting answers saved at the same time.
    if len({str(row.get('answer','')).strip() for row in matches})!=1:return None
    row=matches[0];value=str(row.get('answer','')).strip()
    if not value or any(r.get('reusePolicy')=='manual_only' for r in matches):return None
    if automation_check(question,[*(field.get('options') or []),*(option for r in matches for option in r.get('options',[])),value]):return None
    if kind in {'select','radio'} or kind=='combobox' and field.get('options'):
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
