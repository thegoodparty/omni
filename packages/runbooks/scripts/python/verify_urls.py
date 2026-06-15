import json
import sys
from typing import Callable

import requests

DEFAULT_TIMEOUT = 10

BROWSER_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
}


def verify(
    url: str,
    head: Callable = requests.head,
    get: Callable = requests.get,
    timeout: int = DEFAULT_TIMEOUT,
) -> dict:
    try:
        resp = head(
            url,
            timeout=timeout,
            allow_redirects=True,
            headers=BROWSER_HEADERS,
        )
        status = resp.status_code
        if status in (403, 405) or status == 501:
            resp = get(
                url,
                timeout=timeout,
                allow_redirects=True,
                stream=True,
                headers=BROWSER_HEADERS,
            )
            status = resp.status_code
        return {
            'url': url,
            'status': status,
            'final_url': resp.url,
            'ok': 200 <= status < 300,
        }
    except Exception as e:
        return {
            'url': url,
            'status': None,
            'final_url': None,
            'ok': False,
            'error': str(e),
        }


def verify_many(
    urls: list[str],
    head: Callable = requests.head,
    get: Callable = requests.get,
    timeout: int = DEFAULT_TIMEOUT,
) -> list[dict]:
    return [verify(u, head=head, get=get, timeout=timeout) for u in urls]


if __name__ == '__main__':
    if len(sys.argv) > 1:
        urls = sys.argv[1:]
    else:
        urls = [line.strip() for line in sys.stdin if line.strip()]

    if not urls:
        print(
            'Usage: uv run verify_urls.py <url> [<url> ...]\n'
            '   or: echo "<url>" | uv run verify_urls.py',
            file=sys.stderr,
        )
        sys.exit(1)

    print(json.dumps(verify_many(urls), indent=2))
