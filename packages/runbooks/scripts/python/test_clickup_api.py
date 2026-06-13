import pytest

from clickup_api import delete, get, post, put


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=b'{}'):
        self.status_code = status_code
        self._payload = payload or {}
        self.content = content if status_code != 204 else b''

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def test_builds_v2_url_with_token_auth_no_bearer_prefix():
    captured = {}

    def fake_requester(method, url, headers, params, json, timeout):
        captured['method'] = method
        captured['url'] = url
        captured['headers'] = headers
        captured['params'] = params
        captured['json'] = json
        captured['timeout'] = timeout
        return FakeResponse(payload={"id": "abc"})

    result = get(
        '/team/123/list',
        api_key='pk_test',
        params={'archived': 'false'},
        requester=fake_requester,
    )

    assert captured['method'] == 'GET'
    assert captured['url'] == 'https://api.clickup.com/api/v2/team/123/list'
    # ClickUp v2 sends the token directly — no "Bearer " prefix.
    assert captured['headers']['Authorization'] == 'pk_test'
    assert captured['headers']['Content-Type'] == 'application/json'
    assert captured['params'] == {'archived': 'false'}
    assert captured['json'] is None
    assert result == {"id": "abc"}


def test_post_sends_json_payload():
    captured = {}

    def fake_requester(method, url, headers, params, json, timeout):
        captured['method'] = method
        captured['url'] = url
        captured['json'] = json
        return FakeResponse(payload={"id": "new"})

    payload = {"name": "Test task", "markdown_description": "**body**"}
    result = post(
        '/list/456/task',
        api_key='pk_test',
        payload=payload,
        requester=fake_requester,
    )

    assert captured['method'] == 'POST'
    assert captured['url'] == 'https://api.clickup.com/api/v2/list/456/task'
    assert captured['json'] == payload
    assert result == {"id": "new"}


def test_put_sends_json_payload():
    captured = {}

    def fake_requester(method, url, headers, params, json, timeout):
        captured['method'] = method
        captured['json'] = json
        return FakeResponse(payload={"id": "updated"})

    put('task/abc', api_key='k', payload={"priority": 2}, requester=fake_requester)

    assert captured['method'] == 'PUT'
    assert captured['json'] == {"priority": 2}


def test_strips_leading_slash():
    captured = {}

    def fake_requester(method, url, headers, params, json, timeout):
        captured['url'] = url
        return FakeResponse()

    get('team', api_key='k', requester=fake_requester)
    assert captured['url'] == 'https://api.clickup.com/api/v2/team'


def test_api_version_v3_routes_to_v3_base():
    captured = {}

    def fake_requester(method, url, headers, params, json, timeout):
        captured['url'] = url
        return FakeResponse(payload={"id": "page-1"})

    post(
        'workspaces/123/docs/abc/pages',
        api_key='pk_test',
        payload={"name": "Test", "content": "**md**", "content_format": "text/md"},
        api_version='v3',
        requester=fake_requester,
    )

    assert captured['url'] == 'https://api.clickup.com/api/v3/workspaces/123/docs/abc/pages'


def test_returns_none_on_204_no_content():
    def fake_requester(method, url, headers, params, json, timeout):
        return FakeResponse(status_code=204)

    result = delete('/task/abc/dependency', api_key='k', requester=fake_requester)
    assert result is None


def test_delete_passes_params_and_payload():
    captured = {}

    def fake_requester(method, url, headers, params, json, timeout):
        captured['method'] = method
        captured['url'] = url
        captured['params'] = params
        captured['json'] = json
        return FakeResponse(status_code=204)

    delete(
        'task/abc/dependency',
        api_key='k',
        params={'depends_on': 'def'},
        payload={'reason': 'no longer blocking'},
        requester=fake_requester,
    )

    assert captured['method'] == 'DELETE'
    assert captured['url'] == 'https://api.clickup.com/api/v2/task/abc/dependency'
    assert captured['params'] == {'depends_on': 'def'}
    assert captured['json'] == {'reason': 'no longer blocking'}


def test_raises_on_http_error():
    def fake_requester(method, url, headers, params, json, timeout):
        return FakeResponse(status_code=401)

    with pytest.raises(RuntimeError, match='401'):
        get('/team', api_key='bad', requester=fake_requester)
