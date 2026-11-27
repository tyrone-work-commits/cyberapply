"""Experience-duration answers are supplied by the applicant and reusable library."""
import re


def experience_duration_question(question):
    return bool(re.search(r'\b(?:years?|months?)\b', question, re.I) and re.search(
        r'\b(?:experience|work|worked|working|used|using|professional|cybersecurity|security)\b', question, re.I))
