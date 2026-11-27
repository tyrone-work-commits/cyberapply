"""Compatibility shim: browser recovery is an explicit owner action only."""


class RestartRecovery:
    """Older imports may call this, but startup must never rebuild a form."""
    def __init__(self, call, *args, **kwargs):
        pass

    def check(self, site, token, service=None):
        return None
