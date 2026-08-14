from datetime import date, datetime, timezone

import question_writeback as qw

TODAY = date(2026, 8, 13)
OPTIONS = {
    "answerable": "opt-a",
    "partially_answerable": "opt-p",
    "not_answerable": "opt-n",
}
ROWS = [
    {"question": "Q1", "state": "answerable", "question_ref": "86ak1111"},
    {"question": "Q2", "state": "not_answerable", "question_ref": "86ak2222"},
    {"question": "Q3", "state": "answerable", "question_ref": ""},
]


class _FakeResponse:
    status_code = 200
    content = b"{}"

    def __init__(self, payload=None):
        self._payload = payload if payload is not None else {}

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _recorder(log):
    def fake(method, url, **kwargs):
        log.append((method, url, kwargs.get("json")))
        return _FakeResponse()
    return fake


def _responder(payload):
    def fake(method, url, **kwargs):
        if (kwargs.get("params") or {}).get("page", "0") != "0":
            return _FakeResponse({"tasks": [], "last_page": True})
        return _FakeResponse(payload)
    return fake


def _paged_responder(pages):
    def fake(method, url, **kwargs):
        page = int((kwargs.get("params") or {}).get("page", "0"))
        return _FakeResponse(pages[page])
    return fake


def _task(task_id, field):
    return {"id": task_id, "custom_fields": [field]}


_TYPE_CONFIG = {
    "options": [
        {"id": "opt-a", "name": "answerable", "orderindex": 0},
        {"id": "opt-p", "name": "partially answerable", "orderindex": 1},
        {"id": "opt-n", "name": "not answerable", "orderindex": 2},
    ]
}


def test_rows_without_a_task_ref_are_skipped():
    assert [r["question"] for r in qw.changed_rows(ROWS, {})] == ["Q1", "Q2"]


def test_unchanged_state_is_not_rewritten():
    current = {"86ak1111": "answerable"}
    assert [r["question"] for r in qw.changed_rows(ROWS, current)] == ["Q2"]


def test_write_answer_state_posts_two_fields_per_changed_task():
    log = []
    n = qw.write_answer_state(
        "k", ROWS, state_field_id="f-state", checked_field_id="f-date",
        option_ids=OPTIONS, today=TODAY, current={}, requester=_recorder(log),
    )
    assert n == 2
    urls = [url for _, url, _ in log]
    assert any("task/86ak1111/field/f-state" in u for u in urls)
    assert any("task/86ak1111/field/f-date" in u for u in urls)
    assert all(method == "POST" for method, _, _ in log)


def test_dropdown_is_set_to_the_option_uuid_not_the_label():
    log = []
    qw.write_answer_state(
        "k", [ROWS[0]], state_field_id="f-state", checked_field_id="f-date",
        option_ids=OPTIONS, today=TODAY, current={}, requester=_recorder(log),
    )
    state_payload = [body for _, url, body in log if "f-state" in url][0]
    assert state_payload == {"value": "opt-a"}


def test_last_checked_is_sent_as_epoch_milliseconds():
    # Noon UTC, not local midnight: the runner is UTC and the workspace is US-timezone, so a
    # midnight anchor renders as the previous day in ClickUp.
    log = []
    qw.write_answer_state(
        "k", [ROWS[0]], state_field_id="f-state", checked_field_id="f-date",
        option_ids=OPTIONS, today=TODAY, current={}, requester=_recorder(log),
    )
    date_payload = [body for _, url, body in log if "f-date" in url][0]
    assert date_payload["value"] == 1786622400000
    assert date_payload["value"] == int(
        datetime(2026, 8, 13, 12, tzinfo=timezone.utc).timestamp() * 1000
    )


def test_dropdown_uuid_value_is_resolved_through_type_config():
    payload = {"tasks": [
        _task("86ak1111", {
            "name": "Answer state", "type_config": _TYPE_CONFIG, "value": "opt-a",
        }),
        _task("86ak2222", {
            "name": "Answer state", "type_config": _TYPE_CONFIG, "value": "opt-n",
        }),
    ]}
    assert qw.fetch_current_state("k", "L", requester=_responder(payload)) == {
        "86ak1111": "answerable", "86ak2222": "not_answerable",
    }


def test_dropdown_orderindex_value_is_resolved_through_type_config():
    payload = {"tasks": [
        _task("86ak3333", {
            "name": "Answer state", "type_config": _TYPE_CONFIG, "value": 1,
        }),
    ]}
    assert qw.fetch_current_state("k", "L", requester=_responder(payload)) == {
        "86ak3333": "partially_answerable",
    }


def test_fetch_current_state_follows_pagination_until_last_page():
    pages = [
        {"tasks": [_task("86ak1111", {
            "name": "Answer state", "type_config": _TYPE_CONFIG, "value": "opt-a",
        })], "last_page": False},
        {"tasks": [_task("86ak2222", {
            "name": "Answer state", "type_config": _TYPE_CONFIG, "value": "opt-n",
        })], "last_page": True},
    ]
    assert qw.fetch_current_state("k", "L", requester=_paged_responder(pages)) == {
        "86ak1111": "answerable", "86ak2222": "not_answerable",
    }


def test_a_bare_label_value_is_still_accepted():
    payload = {"tasks": [
        _task("86ak4444", {"name": "Answer state", "value": "answerable"}),
    ]}
    assert qw.fetch_current_state("k", "L", requester=_responder(payload)) == {
        "86ak4444": "answerable",
    }


def test_rows_sharing_a_task_ref_write_once_with_the_worst_state():
    log = []
    rows = [
        {"question": "Q-bad", "state": "not_answerable", "question_ref": "86ak1111"},
        {"question": "Q-good", "state": "answerable", "question_ref": "86ak1111"},
    ]
    n = qw.write_answer_state(
        "k", rows, state_field_id="f-state", checked_field_id="f-date",
        option_ids=OPTIONS, today=TODAY, current={}, requester=_recorder(log),
    )
    assert n == 1
    assert len(log) == 2
    state_payloads = [body for _, url, body in log if "f-state" in url]
    assert state_payloads == [{"value": "opt-n"}]


def test_changed_rows_dedupes_so_the_dry_run_count_matches_what_gets_written():
    rows = [
        {"question": "Q-good", "state": "answerable", "question_ref": "86ak1111"},
        {"question": "Q-bad", "state": "not_answerable", "question_ref": "86ak1111"},
    ]
    deduped = qw.changed_rows(rows, {})
    assert len(deduped) == 1
    assert deduped[0]["state"] == "not_answerable"


def test_unknown_state_label_raises_rather_than_writing_a_wrong_value():
    import pytest

    with pytest.raises(KeyError):
        qw.write_answer_state(
            "k", [{"question": "Q", "state": "invented", "question_ref": "1"}],
            state_field_id="f", checked_field_id="d", option_ids=OPTIONS,
            today=TODAY, current={}, requester=_recorder([]),
        )
