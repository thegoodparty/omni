"""Safety-invariant tests for segment_destination_mapping (DATA-2149).

The Segment workspace is production, so the enabled flag must never ride in
on a payload file. Run from scripts/python with
``uv run pytest test_segment_destination_mapping.py``.
"""

import json
from unittest.mock import MagicMock, patch

import segment_destination_mapping as sdm


def fake_response(body=None):
    response = MagicMock()
    response.ok = True
    response.status_code = 200
    response.json.return_value = body if body is not None else {'data': {}}
    return response


def write_payload(tmp_path, payload):
    path = tmp_path / 'payload.json'
    path.write_text(json.dumps(payload))
    return str(path)


def test_create_subscription_forces_disabled(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv('SEGMENT_PUBLIC_API_TOKEN', 'test-token')
    payload_path = write_payload(
        tmp_path, {'name': 'x', 'trigger': 't', 'enabled': True}
    )
    with patch.object(sdm.requests, 'request', return_value=fake_response()) as req:
        sdm.create_subscription('dest1', payload_path)
    sent = req.call_args.kwargs['json']
    assert sent['enabled'] is False


def test_update_subscription_strips_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv('SEGMENT_PUBLIC_API_TOKEN', 'test-token')
    payload_path = write_payload(
        tmp_path, {'settings': {'event_name': 'x'}, 'enabled': True}
    )
    with patch.object(sdm.requests, 'request', return_value=fake_response()) as req:
        sdm.update_subscription('dest1', 'sub1', payload_path)
    sent = req.call_args.kwargs['json']
    assert 'enabled' not in sent


def test_enable_subscription_is_the_only_enable_path(monkeypatch):
    monkeypatch.setenv('SEGMENT_PUBLIC_API_TOKEN', 'test-token')
    with patch.object(sdm.requests, 'request', return_value=fake_response()) as req:
        sdm.enable_subscription('dest1', 'sub1')
    assert req.call_args.args[0] == 'PATCH'
    assert req.call_args.kwargs['json'] == {'enabled': True}
