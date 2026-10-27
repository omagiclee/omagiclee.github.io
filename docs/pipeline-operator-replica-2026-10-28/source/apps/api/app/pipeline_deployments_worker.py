"""Run interval production scheduling independently of the API process."""
import argparse
import logging
import time
from .pipeline_deployments_service import run_schedules_once


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    while True:
        try:
            run_schedules_once()
        except Exception:
            logging.exception("Deployment scheduler failed; due occurrences remain persisted")
        if args.once:
            return
        time.sleep(2)


if __name__ == "__main__":
    main()
