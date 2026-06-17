import json
import os
import sys
from typing import Any, Callable

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

API_HOST = 'https://api.clickup.com/api'


def request(
    method: str,
    path: str,
    api_key: str,
    params: dict | None = None,
    payload: dict | None = None,
    api_version: str = 'v2',
    requester: Callable = requests.request,
    timeout: int = 30,
) -> Any:
    """Call the ClickUp API.

    Most endpoints are v2 (tasks, lists, comments, dependencies).
    The Docs/Pages API is v3 — pass `api_version='v3'` for those calls.
    """
    base = f'{API_HOST}/{api_version}'
    url = f"{base}/{path.lstrip('/')}"
    headers = {
        'Authorization': api_key,
        'Content-Type': 'application/json',
    }
    response = requester(
        method.upper(),
        url,
        headers=headers,
        params=params,
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    if response.status_code == 204 or not response.content:
        return None
    return response.json()


def get(path: str, api_key: str, params: dict | None = None, **kwargs: Any) -> Any:
    return request('GET', path, api_key, params=params, **kwargs)


def post(path: str, api_key: str, payload: dict, **kwargs: Any) -> Any:
    return request('POST', path, api_key, payload=payload, **kwargs)


def put(path: str, api_key: str, payload: dict, **kwargs: Any) -> Any:
    return request('PUT', path, api_key, payload=payload, **kwargs)


def delete(
    path: str,
    api_key: str,
    params: dict | None = None,
    payload: dict | None = None,
    **kwargs: Any,
) -> Any:
    return request('DELETE', path, api_key, params=params, payload=payload, **kwargs)


def print_usage() -> None:
    print('Usage: uv run clickup_api.py [--api-version=v2|v3] <METHOD> <path> [key=value ...] [@payload.json]')
    print('Examples:')
    print('  uv run clickup_api.py GET team')
    print('  uv run clickup_api.py GET team/$CLICKUP_TEAM_ID/space archived=false')
    print('  uv run clickup_api.py POST list/$CLICKUP_LIST_ID/task @task.json')
    print('  uv run clickup_api.py PUT task/abc123 @update.json')
    print('  uv run clickup_api.py DELETE task/abc123/dependency depends_on=def456')
    print('  uv run clickup_api.py --api-version=v3 POST workspaces/$CLICKUP_TEAM_ID/docs/<doc_id>/pages @page.json')


if __name__ == '__main__':
    args = sys.argv[1:]
    api_version = 'v2'

    # Pull out --api-version=vN if present (must come before METHOD).
    if args and args[0].startswith('--api-version='):
        api_version = args[0].split('=', 1)[1]
        args = args[1:]
    if api_version not in {'v2', 'v3'}:
        print(f'Unknown API version: {api_version} (expected v2 or v3)', file=sys.stderr)
        sys.exit(1)

    if len(args) < 2:
        print_usage()
        sys.exit(1)

    api_key = os.environ.get('CLICKUP_API_KEY')
    if not api_key:
        print('CLICKUP_API_KEY not set in environment or scripts/.env', file=sys.stderr)
        sys.exit(2)

    method = args[0].upper()
    if method not in {'GET', 'POST', 'PUT', 'DELETE'}:
        print(f'Unknown method: {method}', file=sys.stderr)
        print_usage()
        sys.exit(1)

    path = args[1]

    payload: dict | None = None
    params: dict | None = None
    for arg in args[2:]:
        if arg.startswith('@'):
            with open(arg[1:]) as f:
                payload = json.load(f)
        elif '=' in arg:
            params = params or {}
            k, v = arg.split('=', 1)
            params[k] = v
        else:
            print(f'Unknown arg (need key=value or @file.json): {arg}', file=sys.stderr)
            sys.exit(1)

    try:
        result = request(method, path, api_key, params=params, payload=payload, api_version=api_version)
    except requests.HTTPError as e:
        body = ''
        if e.response is not None:
            try:
                body = json.dumps(e.response.json(), indent=2)
            except ValueError:
                body = e.response.text
        print(f'HTTP {e.response.status_code if e.response else "?"} {e}\n{body}', file=sys.stderr)
        sys.exit(3)

    if result is None:
        print('(no body)')
    else:
        print(json.dumps(result, indent=2))
