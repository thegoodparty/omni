"""Safety-invariant tests for hubspot_event_mapping (DATA-2149).

Flows must always be created disabled regardless of the payload file, and
event-definition creation must confirm via exact-name GET (the POST body is
empty). Run from scripts/python with
``uv run pytest test_hubspot_event_mapping.py``.
"""

import json
from unittest.mock import MagicMock, patch

import hubspot_event_mapping as hem


def fake_response(body=None, status=200):
    response = MagicMock()
    response.ok = True
    response.status_code = status
    response.content = b'{}' if body is None else json.dumps(body).encode()
    response.json.return_value = body if body is not None else {}
    return response


def write_payload(tmp_path, payload):
    path = tmp_path / 'payload.json'
    path.write_text(json.dumps(payload))
    return str(path)


def test_create_flow_forces_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv('HUBSPOT_SANDBOX_TOKEN', 'test-token')
    payload_path = write_payload(
        tmp_path, {'name': 'flow', 'isEnabled': True, 'actions': []}
    )
    with patch.object(
        hem.requests, 'request', return_value=fake_response({'id': '1'}, 201)
    ) as req:
        hem.create_flow(payload_path)
    sent = req.call_args.kwargs['json']
    assert sent['isEnabled'] is False


def test_create_event_definition_confirms_by_exact_name(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv('HUBSPOT_SANDBOX_TOKEN', 'test-token')
    payload_path = write_payload(tmp_path, {'name': 'my_event', 'label': 'My Event'})
    definition = {'fullyQualifiedName': 'pe1_my_event', 'objectTypeId': '6-123'}
    responses = [fake_response(None, 201), fake_response(definition)]
    with patch.object(
        hem.requests, 'request', side_effect=responses
    ) as req:
        hem.create_event_definition(payload_path)
    get_call = req.call_args_list[1]
    assert get_call.args[0] == 'GET'
    assert get_call.args[1].endswith('/events/v3/event-definitions/my_event')
    out = capsys.readouterr().out
    assert '6-123' in out
