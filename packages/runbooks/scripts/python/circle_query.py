import json
import os
import sys
from typing import Any, Callable

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

BASE_URL = 'https://app.circle.so/api/admin/v2'


def get(
    path: str,
    api_key: str,
    params: dict | None = None,
    getter: Callable = requests.get,
    timeout: int = 30,
) -> Any:
    url = f"{BASE_URL}/{path.lstrip('/')}"
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    response = getter(url, headers=headers, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: uv run circle_query.py <path> [key=value ...]')
        print('Examples:')
        print('  uv run circle_query.py spaces')
        print('  uv run circle_query.py posts per_page=50 sort=latest')
        sys.exit(1)

    api_key = os.environ.get('CIRCLE_API_KEY')
    if not api_key:
        print('ERROR: CIRCLE_API_KEY not set in scripts/.env', file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1]
    params = dict(arg.split('=', 1) for arg in sys.argv[2:] if '=' in arg)
    print(json.dumps(get(path, api_key=api_key, params=params or None), indent=2))
