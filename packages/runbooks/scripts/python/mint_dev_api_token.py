"""Mint a 1h gp-api session token for an existing dev user via Clerk.

Used by commands/validate-feature.md to call the AdminOrM2MGuard-protected
test-fixtures endpoints as the engineer's own (admin) dev account. Browser-
minted Clerk tokens expire after 60 seconds; a backend-session token minted
with an explicit TTL survives a whole run.

Usage:
    uv run mint_dev_api_token.py <email> [--ttl-seconds 3600]

Reads CLERK_SECRET_KEY_DEV from ../.env (scripts/.env). Prints ONLY the JWT to
stdout so callers can capture it; never echo it into logs or files.
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
    parser.add_argument('email', help='dev-account email to mint a token for')
    parser.add_argument('--ttl-seconds', type=int, default=3600)
    args = parser.parse_args()

    load_dotenv(Path(__file__).resolve().parent.parent / '.env')
    secret = os.environ.get('CLERK_SECRET_KEY_DEV')
    if not secret:
        die('CLERK_SECRET_KEY_DEV missing from scripts/.env', 2)

    headers = {'Authorization': f'Bearer {secret}'}

    users = requests.get(
        f'{CLERK_API}/users',
        headers=headers,
        params={'email_address': [args.email], 'limit': 1},
        timeout=TIMEOUT,
    )
    users.raise_for_status()
    found = users.json()
    if not found:
        die(f'No Clerk user found for {args.email}', 3)
    user_id = found[0]['id']

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
