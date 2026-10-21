"""The cost key on the publish payload.

The runner withholds a cost it could not measure (see `HarnessResult`), so
`publish` has to be able to express "unknown" — and the only spelling this
payload has ever had for an absent optional is an absent key. Sending
`"cost_usd": null` would be a third spelling, and the broker's
`artifact_publish` model would accept it, so nothing downstream would complain
while the wire shape quietly changed.

`report_status` in the same module already omits both of its optionals this
way, and the three qa fields beside `cost_usd` do too. This keeps them
consistent.
"""

from unittest.mock import MagicMock, patch

from pmf_engine.runner.pmf_runtime import publish as publish_mod


def _captured(**kwargs) -> dict:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"ok": True}
    client = MagicMock()
    client.post.return_value = response
    config = MagicMock()
    config.client = client
    with patch.object(publish_mod, "get_config", create=True, return_value=config):
        with patch("pmf_engine.runner.pmf_runtime.config.get_config", return_value=config):
            publish_mod.publish({"greeting": "hello"}, **kwargs)
    return client.post.call_args.kwargs["json"]


def test_a_measured_cost_is_sent():
    body = _captured(duration_seconds=1.5, cost_usd=0.0731)
    assert body["cost_usd"] == 0.0731


def test_a_genuine_zero_is_sent_rather_than_omitted():
    """0.0 is a figure, not an absence. A gate that provably spent nothing has
    to be distinguishable from a run that could not measure."""
    body = _captured(duration_seconds=1.5, cost_usd=0.0)
    assert "cost_usd" in body
    assert body["cost_usd"] == 0.0


def test_an_unknown_cost_omits_the_key_entirely():
    body = _captured(duration_seconds=1.5, cost_usd=None)
    assert "cost_usd" not in body
    # The rest of the payload is untouched, so this is an omission and not a
    # dropped body.
    assert body["artifact"] == {"greeting": "hello"}
    assert body["duration_seconds"] == 1.5


def test_omitting_the_argument_omits_the_key():
    body = _captured(duration_seconds=1.5)
    assert "cost_usd" not in body
