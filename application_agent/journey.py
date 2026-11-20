"""Source-bound employer embeds and bounded, value-free progress diagnostics."""
import re
from urllib.parse import urlsplit, parse_qsl


def greenhouse_source(job):
    """Only server-supplied feed provenance can authorize a branded-page embed.

    The saved original URL must also identify the same vacancy. Page prose,
    redirects and arbitrary supplied URLs cannot add a new application service.
    """
    source = job.get('source') or {}
    if not isinstance(source, dict):
        return None
    board, posting = source.get('board'), source.get('externalId')
    if (source.get('provider') != 'greenhouse' or source.get('region') != 'global'
            or not isinstance(board, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', board)
            or not isinstance(posting, str) or not re.fullmatch(r'[0-9]{1,24}', posting)
            or source.get('boardUrl') != 'https://job-boards.greenhouse.io/' + board):
        return None
    for key in ('url', 'applyUrl'):
        try:
            u = urlsplit(job.get(key) or '')
            if u.scheme != 'https' or u.username or u.password or u.port not in (None, 443):
                continue
            pairs = parse_qsl(u.query, keep_blank_values=True)
            ids = [v for k, v in pairs if k == 'gh_jid']
            canonical = u.hostname in {'boards.greenhouse.io', 'job-boards.greenhouse.io'} and u.path.rstrip('/') == f'/{board}/jobs/{posting}'
            if ids == [posting] or canonical:
                return {'board': board, 'posting': posting}
        except (TypeError, ValueError):
            continue
    return None


def matching_greenhouse_embed(url, source):
    if not source:
        return False
    try:
        u = urlsplit(url)
        pairs = parse_qsl(u.query, keep_blank_values=True)
        boards = [v for k, v in pairs if k == 'for']
        postings = [v for k, v in pairs if k == 'token']
        return bool(u.scheme == 'https' and u.hostname in {'boards.greenhouse.io', 'job-boards.greenhouse.io'}
                    and u.port in (None, 443) and not u.username and not u.password and not u.fragment
                    and u.path == '/embed/job_app' and boards == [source['board']] and postings == [source['posting']]
                    and all(k in {'for', 'token', 'validityToken', 'b', 'gh_src'} for k, _ in pairs)
                    and len(pairs) == len(set(k for k, _ in pairs)))
    except (TypeError, ValueError):
        return False


class Journey:
    MAX_INSPECTIONS = 24
    MAX_SECONDS = 300

    def __init__(self, report, clock):
        self.clock, self.started = clock, clock()
        self.data = report['journey'] = {
            'version': 1, 'inspections': 0, 'form_found': False,
            'cv_attached': False, 'continue_click_attempts': 0,
            'submit_click_attempts': 0, 'possible_delivery': False,
            'stop_reason': '',
        }

    def inspect(self):
        if self.data['inspections'] >= self.MAX_INSPECTIONS or self.clock() - self.started >= self.MAX_SECONDS:
            self.data['stop_reason'] = 'progress_budget'
            return False
        self.data['inspections'] += 1
        return True
