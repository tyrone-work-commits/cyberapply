"""Prepare traceable employer answers without turning missing facts into claims.

This planner needs no paid model. It can summarize CV evidence and propose a
contribution, while questions about undisclosed facts remain unanswered.
"""
from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal, InvalidOperation
from .profile_answers import profile_field, saved_profile_answer, place_key
from .answer_drafts import experience_answer, narrative_draft
from html import unescape
import re
from urllib.parse import urlsplit


_SECURITY = re.compile(r"\b(?:cyber\s*security|information security|infosec|security (?:analyst|engineer|consultant|specialist|officer)|SOC (?:analyst|engineer)|penetration test\w*|threat (?:analyst|hunter)|incident respon\w*|GRC (?:analyst|consultant))\b", re.I)
_MONTHS = {name.lower(): number for number in range(1, 13) for name in (calendar.month_name[number], calendar.month_abbr[number])}
_DATE = r"(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(?:19|20)\d{2}"
_DATES = re.compile(rf"(?P<start>{_DATE})\s*(?:[-–—]|to)\s*(?P<end>{_DATE}|present|current|now)\b", re.I)
_UNSUPPORTED = re.compile(r"\b(?:authori[sz]|citizen|nationality|visa|sponsor|clearance|criminal|convict|disab|veteran|gender|race|ethnic|religion|marital|birth|age|consent|agree|privacy|terms|relocat|willing|notice|start date|availability|current salary|previous salary|minimum salary|lowest salary|right to work|legally|background check)\w*\b", re.I)
_ACTION = re.compile(r"\b(?:built|developed|configured|monitored|investigated|analysed|analyzed|managed|deployed|used|performed|conducted|secured|audited|supported|responded|triaged|tested|implemented|automated|assessed|designed)\b", re.I)
_SKILLS = ("Python", "JavaScript", "TypeScript", "SQL", "Linux", "Windows", "AWS", "Azure", "GCP", "SIEM", "Splunk", "Sentinel", "Wireshark", "Nmap", "Burp Suite", "Nessus", "Metasploit", "incident response", "threat hunting", "vulnerability management", "penetration testing", "risk assessment", "ISO 27001", "NIST", "SOC 2", "firewalls", "network security", "IAM", "Docker", "Kubernetes", "Git")


def _lines(text: str) -> list[str]:
    return [re.sub(r"\s+", " ", line).strip(" \t•*-–") for line in text.splitlines() if line.strip()]


def _index(value: str, today: date, end: bool = False) -> tuple[int, bool]:
    if value.lower() in {"present", "current", "now"}:
        return today.year * 12 + today.month - 1, False
    match = re.fullmatch(r"(?:(\w+)\s+)?(\d{4})", value.strip())
    year = int(match.group(2))
    month = _MONTHS.get((match.group(1) or "").lower())
    # Year-only dates cannot establish exact months. Count only guaranteed
    # full years, and mark the estimate as approximate.
    if month is None:
        return year * 12 + (0 if end else 12), True
    return year * 12 + month - 1 + int(end), False


def cybersecurity_experience(text: str, today: date | None = None) -> dict:
    """Count dated professional security roles, merging overlapping months."""
    today = today or date.today()
    lines = _lines(text)
    section, intervals, evidence, approximate = "", [], [], False
    for number, line in enumerate(lines):
        normalized = line.lower().strip(":")
        if re.fullmatch(r"(?:professional |work |employment |career )?experience|employment history|work history", normalized):
            section = "experience"
            continue
        if re.fullmatch(r"(?:education|academic qualifications|certifications|projects|personal projects|skills|technical skills|summary|profile|awards|references)", normalized):
            section = normalized
            continue
        match = _DATES.search(line)
        if not match or section != "experience":
            continue
        title = line[:match.start()].strip(" |,–—-")
        if not title:
            candidates = lines[max(0, number - 2):number]
            title = next((item for item in reversed(candidates) if _SECURITY.search(item) and not _ACTION.search(item)), "")
        if not _SECURITY.search(title) or _ACTION.search(title):
            continue
        start, start_approx = _index(match.group("start"), today)
        end, end_approx = _index(match.group("end"), today, end=True)
        end = min(end, today.year * 12 + today.month - 1)
        if not 0 < end - start <= 60 * 12:
            continue
        intervals.append((start, end))
        evidence.append(f"{title}: {match.group(0)}")
        approximate |= start_approx or end_approx
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    months = sum(end - start for start, end in merged)
    return {"months": months, "years": round(months / 12, 2), "evidence": evidence,
            "approximate": approximate, "established": bool(evidence),
            "note": "Dated professional cybersecurity roles only; overlaps count once. Year-only dates use a conservative lower bound. Undated work, education and projects do not establish duration."}


def _facts(text: str) -> dict:
    lines = _lines(text)
    email = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.I)
    name = next((line.split(":", 1)[1].strip() for line in lines if re.match(r"^(?:full )?name\s*:", line, re.I)), "")
    if not name and lines:
        first = lines[0]
        if re.fullmatch(r"[^\W\d_]+(?:[ '\-][^\W\d_]+){1,4}", first, re.U) and not re.search(r"resume|curriculum|vitae|engineer|analyst|developer|security|experience|skills", first, re.I):
            name = first
    urls = re.findall(r"(?:https?://|www\.)[^\s<>|]+|(?:github\.com|linkedin\.com)/[^\s<>|]+", text, re.I)
    urls = [url.rstrip(".,;)") if url.startswith("http") else "https://" + url.rstrip(".,;)") for url in urls]
    github = next((url for url in urls if (urlsplit(url).hostname or "").lower() in {"github.com", "www.github.com"}), "")
    linkedin = next((url for url in urls if ((urlsplit(url).hostname or '').lower()=='linkedin.com' or (urlsplit(url).hostname or '').lower().endswith('.linkedin.com')) and re.match(r'^/(?:in|pub)/',urlsplit(url).path,re.I)), '')
    portfolio = next((url for url in urls if url not in {github, linkedin}), "")
    skills = [skill for skill in _SKILLS if re.search(r"(?<!\w)" + re.escape(skill) + r"(?!\w)", text, re.I)]
    return {"name": name, "email": email.group(0) if email else "", "github": github, "linkedin": linkedin, "portfolio": portfolio, "skills": skills}


def _question_key(question: str) -> str:
    """Normalize display spacing/case only; preserve complete wording."""
    return re.sub(r"\s+", " ", question).strip().casefold()


def _confirmed(payload: dict, question: str, field: dict) -> tuple[bool, str | None, str]:
    """Use only explicit answers for this exact job-specific question.

    The bridge supplies this application request's confirmed answers. Similar
    questions, new consent wording and blank values cannot inherit permission.
    """
    supplied = payload.get("confirmedAnswers")
    if not isinstance(supplied, list) or not question:
        return False, None, ""
    matches = [item for item in supplied[:100] if isinstance(item, dict) and isinstance(item.get("question"), str) and isinstance(item.get("value"), str) and _question_key(item["question"]) == _question_key(question)]
    if not matches:
        return False, None, ""
    values = {item["value"].strip() for item in matches}
    if len(values) != 1:
        return True, None, "Conflicting user-confirmed values for this exact question."
    item = matches[0]
    value = item["value"].strip()
    kind = field.get("type", "text")
    if not value or len(value) > 20_000 or kind in {"hidden", "password"} or (kind=="file" and not re.search(r"cover.?letter",question,re.I)):
        return True, None, "The confirmed value is empty or unsupported for this field."
    proof = f"User confirmed question: {item['question']}\nUser confirmed answer: {item['value']}"
    if kind == "checkbox":
        if value.casefold() not in {"yes", "true", "i agree"}:
            return True, None, "This checkbox needs an explicit affirmative answer to its exact statement."
        return True, "true", proof
    if kind in {"radio", "select"}:
        options = field.get("options") or []
        if value not in options:
            return True, None, "The confirmed answer does not exactly match an offered option."
    if kind == "number":
        try:
            if not Decimal(value).is_finite():
                return True, None, "The confirmed answer is not a finite number."
        except InvalidOperation:
            return True, None, "The confirmed answer is not a finite number."
    return True, value, proof


def build_plan(payload: dict, fields: list[dict], research: dict | None = None) -> dict:
    research = research or {}
    text = str((payload.get("cv") or {}).get("text", ""))[:200_000]
    job = payload.get("job") or {}
    facts, experience = _facts(text), cybersecurity_experience(text)
    cv_lines = _lines(text)
    job_tokens = set(re.findall(r"\b[a-z]{4,}\b", str(job.get("description", "")).lower()))
    evidence = sorted([line for line in cv_lines if _ACTION.search(line) and 20 <= len(line) <= 500], key=lambda line: -len(job_tokens.intersection(line.lower().split())))[:3]
    skills = [skill for skill in facts["skills"] if skill.lower() in str(job.get("description", "")).lower()]
    if not skills:
        skills = facts["skills"][:5]
    company, title = str(job.get("company", "the company"))[:140], str(job.get("title", "the advertised role"))[:180]
    contribution = (f"I would bring my CV-listed skills in {', '.join(skills)} to the responsibilities described in the {title} posting." if skills else f"I would bring the experience described in my CV to the responsibilities in the {title} posting.")
    posting_text = unescape(re.sub(r"<[^>]*>", "\n", str(job.get("description", ""))))
    responsibility = next((line.strip(" •*-–") for line in re.split(r"[\n.;]", posting_text) if 30 <= len(line.strip()) <= 240 and re.match(r"\s*(?:monitor|investigate|detect|manage|design|secure|support|assess|lead|implement|protect|respond|maintain|develop|conduct)\b", line, re.I)), None)
    if responsibility:
        contribution += f" The posting specifically asks the successful candidate to {responsibility[0].lower() + responsibility[1:]}. I would use my documented background to support that work and learn the team's operating procedures."
    opportunity = next((item for item in research.get("company_findings", []) if item.get("text") and item.get("source_url")), None)
    if opportunity:
        contribution += f" Your published material highlights {str(opportunity['text'])[:280].rstrip('.')}. I would use the job's responsibilities to guide where I could contribute, then validate priorities with the team."
    cover_letter = f"Dear {company} hiring team,\n\nI am applying for {title}. "
    cover_letter += ("My CV includes the following relevant work: " + " ".join(evidence) + "\n\n") if evidence else "Please consider the experience and qualifications in my attached CV.\n\n"
    cover_letter += contribution + "\n\nI would welcome the opportunity to discuss how this background fits your team's needs.\n\nKind regards,\n" + (facts["name"] or "Applicant")
    answers, unresolved = [], []
    for field in fields[:100]:
        question = str(field.get("label", "")).strip()
        normalized = re.sub(r"\s+", " ", question.lower()).strip(" *:?!")
        kind, value, source, proof = field.get("type", "text"), None, "cv", ""
        user_supplied, confirmed_value, confirmed_proof = _confirmed(payload, question, field)
        profile_key=profile_field(question)
        linkedin_field=bool(re.fullmatch(r'(?:(?:please )?(?:provide|enter|share|add)\s+)?(?:your\s+)?linked\s*in(?: profile)?(?: website| link| url| address)?',normalized))
        profile_reason=""
        if profile_key and kind not in {"password","hidden","file"}:
            value,proof,profile_reason=saved_profile_answer(payload,question,field)
            source="edit_profile"
        elif profile_key:
            profile_reason="This personal detail needs a supported field and the matching saved Edit Profile value."
        elif linkedin_field:
            value=facts['linkedin'] if kind not in {'password','hidden','file'} else None
            source='cv';proof='LinkedIn profile URL extracted from the exact chosen CV.'
        elif user_supplied:
            value, source, proof = confirmed_value, "user_confirmed", confirmed_proof
        elif kind not in {"password","hidden","file"} and not _UNSUPPORTED.search(question) and (match:=experience_answer(question,text,kind)):
            value,proof,generated=match
            source="cv_and_job" if generated else "cv"
        elif _UNSUPPORTED.search(question) or kind in {"checkbox", "radio", "password", "hidden"}:
            pass
        elif re.search(r"years? .*(?:cyber\s*security|information security)|(?:cyber\s*security|information security).*years?", normalized) and experience["established"]:
            value, proof = str(experience["years"]), "; ".join(experience["evidence"])
        elif re.fullmatch(r"(?:your )?(?:email|e-mail)(?: address)?", normalized):
            value = facts["email"]
        elif re.fullmatch(r"(?:your )?github(?: repository| profile| link| url)?", normalized):
            value = facts["github"]
        elif re.fullmatch(r"(?:your )?(?:portfolio|personal)(?: website| link| url)?", normalized):
            value = facts["portfolio"]
        elif re.fullmatch(r"(?:cover|covering|motivation) letter", normalized):
            value, source, proof = cover_letter, "cv_and_job", "; ".join(evidence)
        elif kind == "file":
            # The browser runner receives bytes separately and must validate
            # the selected CV digest. No local filename is inferred here.
            pass
        elif re.search(r"\b(?:why|motivat|contribut|add value|interested|good fit)\w*\b", normalized) and not re.search(r"left|leav|previous|last employer", normalized):
            value, source, proof = contribution, "cv_and_job", ", ".join(skills)
        elif re.search(r"\b(?:skills|technologies|tools)\b", normalized) and facts["skills"]:
            source="cv_and_job"
            value, proof = "My CV lists " + ", ".join(facts["skills"][:12]) + ".", ", ".join(facts["skills"])
        elif re.search(r"\b(?:describe|summarize|outline|tell us)\b.*\b(?:experience|background)\b", normalized) and evidence:
            # Use literal evidence rather than synthesizing new achievements.
            topic = re.search(r"\bexperience\s+(?:with|in|using)\s+(.+?)[?.!]*$", normalized)
            selected_evidence = evidence
            if topic:
                topic_words = set(re.findall(r"\b[a-z]{3,}\b", topic[1])) - {"the", "and", "this", "role", "your", "field"}
                selected_evidence = [line for line in evidence if topic_words.intersection(set(re.findall(r"\b[a-z]{3,}\b", line.lower()))) ] if topic_words else evidence
            if selected_evidence:
                source="cv_and_job"
                value, proof = "My CV describes: " + " ".join(selected_evidence), "; ".join(selected_evidence)
        if not value and not profile_key and not linkedin_field and not user_supplied and kind in {"text","textarea"} and not _UNSUPPORTED.search(question) and not re.search(r"experience (?:with|in|using|as)|have you (?:used|worked with)",question,re.I):
            draft=narrative_draft(question,text,job,contribution)
            if draft:value,source,proof=draft,"cv_and_job","CV evidence and selected role; user review required."
        if value and source=="cv_and_job":
            unresolved.append({"field_id":field.get("id"),"question":question,"reason":"The agent generated this draft. Review or edit it, then explicitly approve it before it is used.","source":"generated","suggested_value":str(value),"evidence":proof,"required":bool(field.get("required"))})
            continue
        if kind=="checkbox" and value in {"Yes","No"}:value="true" if value=="Yes" else "false"
        if value:
            options = field.get("options") or []
            if options:
                match = next((str(option) for option in options if str(option).casefold().strip() == str(value).casefold().strip() or profile_key=='country' and place_key(option)==place_key(value)), None)
                value = match
            if value is not None:
                answers.append({"field_id": field.get("id"), "value": str(value), "source": source, "evidence": proof or str(value)})
                continue
        if field.get("required"):
            reason = "A personal, eligibility, consent or screening answer must be supplied by the user." if _UNSUPPORTED.search(question) or kind in {"checkbox", "radio"} else "The CV and verified research do not establish a reliable answer."
            if profile_key:
                reason = profile_reason or "The saved Edit Profile value does not match an offered option. Update the profile or complete this field yourself."
            if linkedin_field:reason='No supported personal LinkedIn profile URL was found in the chosen CV. Upload a CV containing the correct LinkedIn link; no saved answer or generated replacement is used.'
            if kind == "file":
                reason = "The browser runner must upload the selected CV or a separately generated cover-letter file."
            if user_supplied and confirmed_value is None and not profile_key:
                reason = confirmed_proof
            unresolved.append({"field_id": field.get("id"), "question": question, "reason": reason, **({"source":"edit_profile","profile_field":profile_key} if profile_key else {})})
    return {"answers": answers, "unresolved": unresolved, "cover_letter": cover_letter, "experience": experience,
            "research_sources": research.get("sources", []), "method": "cv_evidence_saved_edit_profile_and_company_research"}
