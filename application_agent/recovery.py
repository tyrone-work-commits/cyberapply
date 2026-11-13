"""Bounded in-page repairs. Never replay an application or its final click."""
import time


class TransientFormError(Exception):
    """A temporary UI failure, not permission to invent an answer."""


class RecoveryStopped(Exception):
    pass


class FormRecovery:
    MAX_RETRIES = 8
    MAX_SECONDS = 30
    MAX_ATTEMPTS = 3
    ACTIONS = {'open_employer_page','read_form','fill_saved_answer','select_native_option','select_labelled_dropdown'}

    def __init__(self, report, can_retry, wait, clock=time.monotonic):
        self.report, self.can_retry, self.wait, self.clock = report, can_retry, wait, clock
        self.retries = 0
        self.started = None
        report['recovery'] = {'policy':'bounded-in-page-v1', 'events':[], 'retries':0}

    def run(self, action, operation, field_id=None):
        """Only caller-approved idempotent operations belong here.

        Logs use fixed action names/field IDs, never values, URLs or exceptions.
        Unknown errors are propagated. Each retry rechecks current authorization.
        """
        if action not in self.ACTIONS:raise ValueError('This action cannot be automatically replayed.')
        events = self.report['recovery']['events']
        event = None
        for attempt in range(1, self.MAX_ATTEMPTS + 1):
            if event is not None:
                if self.clock()-self.started>=self.MAX_SECONDS:
                    raise RecoveryStopped('Automatic form repair reached its time limit. The request is paused.') from None
                # Check after the wait, immediately before replay: an autosave
                # or revocation can arrive while the page is settling.
                if self.can_retry() is not True:
                    event['outcome']='stopped'
                    raise RecoveryStopped('Automatic form repair stopped because authorization changed or data may already have been sent. Check the application outcome before retrying.') from None
                if self.clock()-self.started>=self.MAX_SECONDS:
                    raise RecoveryStopped('Automatic form repair reached its time limit. The request is paused.') from None
                self.retries+=1
                self.report['recovery']['retries']=self.retries
                event['attempts']=attempt
            try:
                result = operation()
                if event is not None:event['outcome']='recovered'
                return result
            except Exception as error:
                transient = isinstance(error, TransientFormError) or type(error).__name__=='TimeoutError'
                if not transient:raise
                if event is None:
                    event={'action':action,'attempts':attempt,'outcome':'paused'}
                    if field_id:event['field_id']=field_id
                    if len(events)<20:events.append(event)
                event['attempts']=attempt
                if self.started is None:self.started=self.clock()
                if (attempt>=self.MAX_ATTEMPTS or self.retries>=self.MAX_RETRIES
                        or self.clock()-self.started>=self.MAX_SECONDS):
                    raise RecoveryStopped('Automatic form repair reached its limit. The request is paused; no submission will be retried.') from None
                self.wait(200*attempt)
