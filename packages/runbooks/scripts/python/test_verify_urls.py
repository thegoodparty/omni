from verify_urls import verify, verify_many


class FakeResponse:
    def __init__(self, status_code=200, url=None, history=None):
        self.status_code = status_code
        self.url = url or 'http://example.com'
        self.history = history or []


def _fake_head(status=200, final_url=None, history=None):
    def _h(url, timeout, allow_redirects, headers=None):
        return FakeResponse(
            status_code=status,
            url=final_url or url,
            history=history or [],
        )
    return _h


def test_ok_when_head_returns_200():
    result = verify('https://example.com', head=_fake_head(200))
    assert result == {
        'url': 'https://example.com',
        'status': 200,
        'final_url': 'https://example.com',
        'ok': True,
    }


def test_not_ok_when_head_returns_404():
    result = verify('https://example.com/missing', head=_fake_head(404))
    assert result['ok'] is False
    assert result['status'] == 404


def test_records_final_url_after_redirect():
    head = _fake_head(
        status=200,
        final_url='https://example.com/canonical',
        history=[FakeResponse(status_code=301)],
    )
    result = verify('https://example.com/old', head=head)
    assert result['final_url'] == 'https://example.com/canonical'
    assert result['ok'] is True


def test_falls_back_to_get_when_head_returns_405():
    def head(url, timeout, allow_redirects, headers=None):
        return FakeResponse(status_code=405, url=url)

    def get(url, timeout, allow_redirects, stream, headers=None):
        return FakeResponse(status_code=200, url=url)

    result = verify('https://blocks-head.example.com', head=head, get=get)
    assert result['status'] == 200
    assert result['ok'] is True


def test_falls_back_to_get_when_head_returns_403():
    def head(url, timeout, allow_redirects, headers=None):
        return FakeResponse(status_code=403, url=url)

    def get(url, timeout, allow_redirects, stream, headers=None):
        return FakeResponse(status_code=200, url=url)

    result = verify('https://blocks-head.example.com', head=head, get=get)
    assert result['ok'] is True


def test_sends_browser_user_agent_to_avoid_bot_blocks():
    captured = {}

    def head(url, timeout, allow_redirects, headers=None):
        captured['headers'] = headers
        return FakeResponse(status_code=200, url=url)

    verify('https://blocks-default-ua.example.com', head=head)
    assert 'User-Agent' in captured['headers']
    assert 'Mozilla' in captured['headers']['User-Agent']


def test_records_error_on_exception():
    def head(url, timeout, allow_redirects, headers=None):
        raise RuntimeError('connection refused')

    result = verify('https://unreachable.example.com', head=head)
    assert result['ok'] is False
    assert result['status'] is None
    assert 'connection refused' in result['error']


def test_verify_many_returns_one_row_per_url():
    head = _fake_head(200)
    results = verify_many(
        ['https://a.example.com', 'https://b.example.com'],
        head=head,
    )
    assert len(results) == 2
    assert {r['url'] for r in results} == {
        'https://a.example.com',
        'https://b.example.com',
    }
    assert all(r['ok'] for r in results)
