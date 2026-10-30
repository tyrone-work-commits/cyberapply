"""CV-grounded drafts for review; unknown personal facts are never invented."""
import re

def experience_answer(question,text,kind):
    if re.search(r'\byears?|months?\b',question,re.I):return None
    match=re.search(r'(?:experience (?:with|in|using|as)|have you (?:used|worked with)|(?:proficient|proficiency) (?:with|in)|knowledge of|familiar with)\s+(.+?)[?!.]*$',question,re.I)
    if not match:return None
    topic=re.sub(r'\s+(?:before|professionally|in (?:a |the )?(?:previous |professional )?role)\s*$','',match[1],flags=re.I).strip(' ?."')
    topics=[x.strip() for x in re.split(r'\s+and\s+|,',topic,flags=re.I)]
    proof=[]
    for target in topics:
        if not target or len(target)>100:return None
        pattern=r'(?<!\w)'+re.escape(target)+r'(?!\w)'
        lines=[line.strip(' -*•') for line in text.splitlines() if re.search(pattern,line,re.I) and not re.search(r'\b(?:no experience|never used|do not know|learning|wish to learn|interested in learning)\b',line,re.I)]
        if not lines:return None
        proof.append(lines[0][:500])
    if kind in {'select','radio','checkbox','combobox'}:return 'Yes','; '.join(proof),False
    return 'Yes. My CV includes: '+' '.join(dict.fromkeys(proof)),'; '.join(proof),True

def narrative_draft(question,text,job,contribution):
    """Draft only open prose, never numeric, legal, preference or identity answers."""
    if re.search(r'\b(?:age|birth|gender|race|ethnic|religion|marital|citizen|criminal|convict|disab|veteran|consent|agree|privacy|terms|clearance|notice|availability|start date|left|leave|leaving|dismissed|termination|relocat|willing|salary|compensation|phone|address|location|country|city|postal|zip|years|months|how many|which|what is your|what are your)\b',question,re.I):return None
    if re.search(r'\b(?:why|describe|explain|tell us|summari[sz]e|outline|approach|contribute|interested|strength|challenge|motivation)\b',question,re.I):
        evidence=[line.strip(' -*•') for line in text.splitlines() if re.search(r'\b(?:built|developed|monitored|investigated|managed|tested|implemented|supported|assessed|configured)\b',line,re.I)]
        if not evidence:return None
        words=set(re.findall(r'\b[a-z]{4,}\b',question.casefold()))
        ranked=sorted(evidence,key=lambda line:-len(words.intersection(re.findall(r'\b[a-z]{4,}\b',line.casefold()))))[:2]
        return 'My CV describes the following relevant work: '+' '.join(ranked)+' '+contribution
    return None
