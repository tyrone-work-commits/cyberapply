"""Windows URI entry point. This opens setup only; no URI data is executed."""
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from application_agent.setup_launcher import open_setup_uri

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Invalid setup link.')
    open_setup_uri(sys.argv[1])
