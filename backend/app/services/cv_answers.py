"""Conservative, traceable answers to a small set of open employer questions.

The selected CV is the only evidence source. Unsupported questions return no
answer, so the browser agent stops before submitting the application.
"""
from __future__ import annotations

import re

_SKILLS_HEADING = re.compile(r"^(?:technical |core |key )?(?:skills|technologies|tools)(?:\s*:\s*(.*))?$", re.I)
_SECTION_HEADING = re.compile(r"^(?:summary|profile|experience|work experience|projects|education|certifications|references)\s*:?$", re.I)
_SKILLS_QUESTION = re.compile(
    r"^(?:(?:what|which)\b.*\b(?:skills|tools|technologies)\b.*\bdo you have|"
    r"list (?:your )?(?:technical )?(?:skills|tools|technologies))\s*[?.!]*$",
    re.I,
)
_EXPERIENCE_QUESTION = re.compile(r"^(?:describe|summarize|outline|tell us about)\b.*\bexperience\s+(?:with|in|using)\s+([\w +.#/-]{2,60})[?.!]*$", re.I)
_ACTION = re.compile(r"\b(?:built|developed|configured|monitored|investigated|analysed|analyzed|managed|deployed|used|performed|conducted|secured|audited|supported|responded|triaged|tested|implemented)\b", re.I)
_NEGATION = re.compile(r"\b(?:no|not|never|without|limited)\b", re.I)


def answer_from_cv(question: str, cv_text: str) -> str | None:
    """Return a bounded answer with verbatim CV evidence, or abstain.

    This does not answer eligibility, consent, salary, duration, preferences,
    hypothetical scenarios, or free-form motivation questions.
    """
    if not isinstance(question, str) or not isinstance(cv_text, str):
        return None
    question = re.sub(r"\s+", " ", question).strip()
    if not question or len(question) > 240 or len(cv_text) > 200_000:
        return None
    if re.search(r"\b(?:years?|months?|salary|pay|compensation|authorized|authorised|visa|sponsor|clearance|citizen|consent|agree|why|motivat|prefer|willing|relocat|disabilit|veteran|gender|race|ethnic|time)\b", question, re.I):
        return None
    lines = [re.sub(r"\s+", " ", line).strip(" \t•*-–") for line in cv_text.splitlines()]
    lines = [line for line in lines if 2 <= len(line) <= 300]

    if _SKILLS_QUESTION.match(question):
        for index, line in enumerate(lines):
            match = _SKILLS_HEADING.fullmatch(line)
            if not match:
                continue
            values = [match.group(1)] if match.group(1) else []
            for following in lines[index + 1:index + 6]:
                if _SECTION_HEADING.fullmatch(following) or _SKILLS_HEADING.fullmatch(following):
                    break
                values.append(following)
            items = []
            for value in values:
                for raw in re.split(r"[,;|•]", value):
                    item = raw.strip(" \t•*-–.;:")
                    if 2 <= len(item) <= 60 and len(item.split()) <= 5 and not _NEGATION.search(item):
                        if item.casefold() not in {seen.casefold() for seen in items}:
                            items.append(item)
            if items:
                return "My CV lists " + ", ".join(items[:6]) + "."
        return None

    match = _EXPERIENCE_QUESTION.match(question)
    if match:
        topic = match.group(1).strip(" .?!")
        # A broad topic invites a subjective summary; only a specific skill or
        # technology can be matched safely to a concrete CV action line.
        if len(topic.split()) > 4 or topic.casefold() in {"this role", "cybersecurity", "security", "your field"}:
            return None
        pattern = re.compile(r"(?<!\w)" + re.escape(topic) + r"(?!\w)", re.I)
        for line in lines:
            if 20 <= len(line) <= 240 and pattern.search(line) and _ACTION.search(line) and not _NEGATION.search(line):
                return "My CV states: " + line.rstrip(".") + "."
    return None
