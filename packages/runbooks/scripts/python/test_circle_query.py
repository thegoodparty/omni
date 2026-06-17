from circle_query import get


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def test_builds_admin_v2_url_with_bearer_auth():
    captured = {}

    def fake_getter(url, headers, params, timeout):
        captured['url'] = url
        captured['headers'] = headers
        captured['params'] = params
        captured['timeout'] = timeout
        return FakeResponse(payload={"records": []})

    result = get(
        '/spaces',
        api_key='test-token-123',
        params={'per_page': 10},
        getter=fake_getter,
    )

    assert captured['url'] == 'https://app.circle.so/api/admin/v2/spaces'
    assert captured['headers']['Authorization'] == 'Bearer test-token-123'
    assert captured['headers']['Content-Type'] == 'application/json'
    assert captured['params'] == {'per_page': 10}
    assert result == {"records": []}


def test_strips_leading_slash_and_joins_path():
    captured = {}

    def fake_getter(url, headers, params, timeout):
        captured['url'] = url
        return FakeResponse()

    get('posts', api_key='k', getter=fake_getter)
    assert captured['url'] == 'https://app.circle.so/api/admin/v2/posts'


def test_raises_on_http_error():
    def fake_getter(url, headers, params, timeout):
        return FakeResponse(status_code=401)

    try:
        get('/spaces', api_key='bad', getter=fake_getter)
    except RuntimeError as e:
        assert '401' in str(e)
        return
    raise AssertionError("expected RuntimeError for 401")
