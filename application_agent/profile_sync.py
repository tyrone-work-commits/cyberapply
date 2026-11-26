"""Apply owner-requested saved-answer revisions within an existing unsent form."""
from urllib.parse import urlencode
from urllib.error import HTTPError

class ProfileSync:
    def __init__(self,call,task):
        self.call=call;self.task=task;self.pending=None;self.failed=False;self.ack_body=None
    def poll(self):
        if self.ack_body:
            try:self.flush_ack()
            except HTTPError as error:
                if error.code!=409:raise
                self.ack_body=None  # A newer saved revision needs an explicit sync request.
        path='/api/application-agent/profile-sync?'+urlencode({k:self.task[k] for k in ('requestId','claimId')})
        try:data=self.call(path,None)
        except HTTPError as error:
            if error.code in {404,405}:return False
            raise
        sync=data.get('sync')
        if not sync or sync.get('state')!='pending' or self.pending and self.pending['id']==sync['id']:return False
        if sync.get('claimId')!=self.task['claimId'] or not isinstance(data.get('applicantProfile'),dict) or not isinstance(data.get('confirmedAnswers'),list):raise ValueError('The saved-answer revision does not belong to this browser.')
        self.task['applicantProfile']=data['applicantProfile'];self.task['confirmedAnswers']=data['confirmedAnswers'];self.pending=sync;self.failed=False
        return True
    def acknowledge(self,report,code=None):
        if not self.pending:return
        body={**{k:self.task[k] for k in ('requestId','claimId')},'id':self.pending['id'],'profileSyncVersion':1,**({'code':code} if code else {})}
        # Acknowledge only the revision; never cookies, verification data or applicant values.
        self.ack_body=body;self.flush_ack()
    def flush_ack(self):
        self.call('/api/application-agent/profile-sync',self.ack_body)
        self.failed=bool(self.ack_body.get('code'));self.pending=None;self.ack_body=None
