"""Enrollment and heartbeat agent for configured local Dagster/Docker targets.

This agent reports liveness. Actual run execution remains the Dagster launcher;
it does not implement a remote-agent task/results transport.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import httpx


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True,help='Server-owned JSON registration config (no credential values)')
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--draining',action='store_true')
    args=parser.parse_args()
    payload=json.loads(Path(args.config).read_text())
    api=os.getenv('FLYWHEEL_CONTROL_API','http://127.0.0.1:8000').rstrip('/')
    state=Path(os.getenv('FLYWHEEL_WORKER_STATE_DIR','.data/workers'))/(hashlib.sha256(args.config.encode()).hexdigest()+'.json')
    state.parent.mkdir(parents=True,exist_ok=True)
    with httpx.Client(timeout=15,trust_env=False) as client:
        if not state.exists():
            response=client.post(api+'/api/execution-workers/register',json=payload,
                headers={'Authorization':'Bearer '+os.environ.get('FLYWHEEL_WORKER_ENROLL_TOKEN','')})
            response.raise_for_status();registration=response.json()
            descriptor=os.open(state,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(descriptor,'w') as output:json.dump({'id':registration['id'],'worker_token':registration['worker_token']},output)
        registration=json.loads(state.read_text())
        while True:
            response=client.post(api+'/api/execution-workers/'+registration['id']+'/heartbeat',
                json={'healthy':True,'draining':args.draining},headers={'Authorization':'Bearer '+registration['worker_token']})
            response.raise_for_status()
            print(json.dumps({'worker_id':registration['id'],'healthy':response.json()['healthy'],'draining':args.draining}),flush=True)
            if args.once:return
            time.sleep(20)

if __name__=='__main__':main()
