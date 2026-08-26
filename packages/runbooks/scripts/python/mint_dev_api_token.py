"""Mint a 1h gp-api session token for the engineer's own dev user via Clerk.

Used by commands/validate-feature.md to call the AdminOrM2MGuard-protected
test-fixtures endpoints as the engineer's own (admin) dev account. Browser-
minted Clerk tokens expire after 60 seconds; a backend-session token minted
with an explicit TTL survives a whole run.

The identity comes ONLY from the CLERK_DEV_USER_ID env var, set once by the
engineer in scripts/.env — deliberately not a CLI argument, so an agent-driven
or prompt-injected invocation can never choose whose token gets minted
(confused-deputy). There is no email lookup for the same reason.

Usage:
    uv run mint_dev_api_token.py [--ttl-seconds 3600]

Reads CLERK_SECRET_KEY_DEV and CLERK_DEV_USER_ID from ../.env (scripts/.env).
Prints ONLY the JWT to stdout so callers can capture it; never echo it into
logs or files.
"""

import argparse
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

CLERK_API = 'https://api.clerk.com/v1'
TIMEOUT = 30


def die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    sys.exit(code)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ttl-seconds', type=int, default=3600)
    args = parser.parse_args()

    load_dotenv(Path(__file__).resolve().parent.parent / '.env')
    secret = os.environ.get('CLERK_SECRET_KEY_DEV')
    if not secret:
        die('CLERK_SECRET_KEY_DEV missing from scripts/.env', 2)
    user_id = os.environ.get('CLERK_DEV_USER_ID')
    if not user_id:
        die(
            'CLERK_DEV_USER_ID missing from scripts/.env (your own '
            'dev-account Clerk user id, user_...)',
            2,
        )

    headers = {'Authorization': f'Bearer {secret}'}

    session = requests.post(
        f'{CLERK_API}/sessions',
        headers=headers,
        json={'user_id': user_id},
        timeout=TIMEOUT,
    )
    session.raise_for_status()
    session_id = session.json()['id']

    token = requests.post(
        f'{CLERK_API}/sessions/{session_id}/tokens',
        headers=headers,
        json={'expires_in_seconds': args.ttl_seconds},
        timeout=TIMEOUT,
    )
    token.raise_for_status()
    print(token.json()['jwt'])


if __name__ == '__main__':
    main()
