"""Value-free diagnosis of a visible employer error; never retry a submission."""
import re
from urllib.parse import urlsplit

PROCESSING_ERROR = re.compile(r'\bthere was an error processing your application\.?\s*please try again\.?', re.I)


def observed_processing_error(frames):
    # Only actual visible error UI, not a job description quoting the message.
    for frame in frames:
        try:
            errors = frame.locator('#submit-error:visible,[role="alert"]:visible,.application-error:visible')
            for i in range(min(errors.count(), 12)):
                if PROCESSING_ERROR.search(errors.nth(i).inner_text(timeout=500)[:3000]):
                    return True
        except Exception:
            pass  # A navigation may replace the document; keep the same page.
    return False


def submission_http_error(response, hosts, page):
    """Retain a status only for this page's Greenhouse submission POST.

    Never retain URLs, queries, tokens, headers, bodies or applicant values.
    HTTP status is diagnostic evidence, not proof of delivery or its absence.
    """
    try:
        request = response.request
        url = urlsplit(response.url)
        if (request.method == 'POST' and request.frame.page is page
                and url.scheme == 'https' and url.hostname in hosts
                and url.hostname in {'boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards.eu.greenhouse.io', 'job-boards.eu.greenhouse.io'}
                and re.fullmatch(r'/[^/]+/jobs/\d+/?', url.path)
                and 400 <= response.status <= 599):
            return response.status
    except Exception:
        pass
    return None
