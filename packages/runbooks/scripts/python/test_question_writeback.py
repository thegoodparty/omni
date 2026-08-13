from datetime import date

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

    def raise_for_status(self):
        return None

    def json(self):
        return {}


def _recorder(log):
    def fake(method, url, **kwargs):
        log.append((method, url, kwargs.get("json")))
        return _FakeResponse()
    return fake


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
    log = []
    qw.write_answer_state(
        "k", [ROWS[0]], state_field_id="f-state", checked_field_id="f-date",
        option_ids=OPTIONS, today=TODAY, current={}, requester=_recorder(log),
    )
    date_payload = [body for _, url, body in log if "f-date" in url][0]
    assert date_payload["value"] == int(
        __import__("datetime").datetime(2026, 8, 13).timestamp() * 1000
    )


def test_unknown_state_label_raises_rather_than_writing_a_wrong_value():
    import pytest

    with pytest.raises(KeyError):
        qw.write_answer_state(
            "k", [{"question": "Q", "state": "invented", "question_ref": "1"}],
            state_field_id="f", checked_field_id="d", option_ids=OPTIONS,
            today=TODAY, current={}, requester=_recorder([]),
        )
