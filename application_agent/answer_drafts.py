"""Automatic CV-grounded prose; unknown personal facts are never invented."""
import re

def narrative_evidence(text):
    """Reconstruct PDF-wrapped evidence without joining separate CV bullets."""
    action=re.compile(r'\b(?:built|developed|monitored|investigated|managed|tested|implemented|supported|assessed|configured)\b',re.I)
    statements=[]
    pending=''
    for raw in text.splitlines():
        line=re.sub(r'\s+',' ',raw).strip()
        bullet=bool(re.match(r'^[-•*]\s+',line))
        line=re.sub(r'^[-•*]\s+','',line)
        if not line or re.fullmatch(r'[A-Z\s&/()-]+',line) or (not bullet and re.match(r'^[^:.!?]{1,70}:\s',line)):
            if pending:statements.append(pending)
            pending=''
            continue
        if bullet or (not pending and action.search(line)) or action.match(line):
            if pending:statements.append(pending)
            pending=line
        elif pending:pending+=('' if pending.endswith('-') else ' ')+line
        if re.search(r'[.!?]$',pending):
            statements.append(pending)
            pending=''
    if pending:statements.append(pending)
    return [line for line in statements if 20<=len(line)<=500 and action.search(line) and not re.search(r'\b(?:no experience|never used|wish to|want to|learning to)\b',line,re.I) and not re.search(r'\b(?:and|or|with|using|to|for|of|the|a|an)\s*$',line,re.I)]

def experience_answer(question,text,kind):
    if re.search(r'\byears?|months?\b',question,re.I):return None
    match=re.search(r'(?:experience (?:with|in|using|as)|have you (?:used|worked with)|(?:proficient|proficiency) (?:with|in)|knowledge of|familiar with)\s+(.+?)[?!.]*$',question,re.I)
    if not match:return None
    raw_topic=re.split(r'\?\s*|\b(?:please explain|please describe|and explain|provide details)\b',match[1],maxsplit=1,flags=re.I)[0]
    topic=re.sub(r'\s+(?:before|professionally|in (?:a |the )?(?:previous |professional )?role)\s*$','',raw_topic,flags=re.I).strip(' ?."')
    topics=[x.strip() for x in re.split(r'\s+and\s+|,',topic,flags=re.I)]
    proof=[]
    for target in topics:
        if not target or len(target)>100:return None
        pattern=r'(?<!\w)'+re.escape(target)+r'(?!\w)'
        lines=[line.strip(' -*•') for line in text.splitlines() if re.search(pattern,line,re.I) and not re.search(r'\b(?:no experience|never used|do not know|learning|wish to learn|interested in learning)\b',line,re.I)]
        if not lines:return None
        proof.append(lines[0][:500])
    if kind in {'select','radio','checkbox','combobox'}:return 'Yes','; '.join(proof),False
    return ('Yes. ' if re.match(r'(?:do|have|are|can)\b',question,re.I) else '')+'My CV includes: '+' '.join(dict.fromkeys(proof)),'; '.join(proof),True

def narrative_draft(question,text,job,contribution):
    """Draft only open prose, never numeric, legal, preference or identity answers."""
    if re.search(r'\b(?:age|birth|gender|race|ethnic|religion|marital|citizen|criminal|convict|disab|veteran|consent|agree|privacy|terms|clearance|notice|availability|start date|left|leave|leaving|dismissed|termination|relocat|willing|salary|compensation|phone|address|location|country|city|postal|zip|years|months|how many|which|hear about|heard about|referral|favo(?:u)?rite|hobbies|hobby)\b',question,re.I):return None
    if re.search(r'\b(?:what (?:interests|motivates|would|can you|are your (?:professional )?strengths|do you bring)|how (?:do|did)|anything else|work experience|relevant experience|professional summary|about (?:you|yourself)|personal statement|additional (?:information|info)|why|describe|explain|tell us|summari[sz]e|outline|approach|contribute|interested|strength|challenge|motivation|how (?:would|could|will) you)\b',question,re.I):
        evidence=narrative_evidence(text)
        if not evidence:return None
        words=set(re.findall(r'\b[a-z]{4,}\b',question.casefold()))
        ranked=sorted(evidence,key=lambda line:-len(words.intersection(re.findall(r'\b[a-z]{4,}\b',line.casefold()))))[:2]
        sentences=[line if re.search(r'[.!?]$',line) else line+'.' for line in ranked]
        return 'My CV describes the following relevant work: '+' '.join(sentences)+' '+contribution
    return None
