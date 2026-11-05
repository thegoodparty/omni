import json

import httpx
import pytest

from case_scout.reader.case_lists import (
    LIST_SOFT_CAP,
    CaseListFetchError,
    CaseListInfo,
    FakeChatCaseListReader,
    GithubChatCaseListReader,
)


def _response(status_code=200, payload=None):
    request = httpx.Request("GET", "https://raw.githubusercontent.com/x")
    content = b"" if payload is None else json.dumps(payload).encode()
    return httpx.Response(status_code=status_code, content=content, request=request)


class _FakeHttpClient:
    def __init__(self, response):
        self._response = response

    def get(self, url, timeout=None):
        return self._response


class TestCaseListInfo:
    def test_is_full_at_or_above_the_soft_cap(self):
        info = CaseListInfo(
            agent_id="chief_of_staff",
            case_count=LIST_SOFT_CAP,
            case_ids=frozenset(),
            conditions=(),
            fixture_description="",
        )
        assert info.is_full is True

    def test_is_not_full_below_the_soft_cap(self):
        info = CaseListInfo(
            agent_id="chief_of_staff",
            case_count=LIST_SOFT_CAP - 1,
            case_ids=frozenset(),
            conditions=(),
            fixture_description="",
        )
        assert info.is_full is False

    def test_empty_is_never_full(self):
        assert CaseListInfo.empty("chief_of_staff").is_full is False


class TestGithubChatCaseListReader:
    def test_parses_conditions_count_and_fixture_note(self):
        payload = {
            "agentId": "campaign_assistant",
            "note": "the fixture description",
            "cases": [
                {"caseId": "a", "condition": "condition a", "handledWhen": "h"},
                {"caseId": "control", "scored": False},
            ],
        }
        client = _FakeHttpClient(_response(payload=payload))
        reader = GithubChatCaseListReader(client=client)

        info = reader.read("campaign_assistant")

        assert info.case_count == 2
        assert info.conditions == ("condition a",)
        assert info.case_ids == frozenset({"a", "control"})
        assert info.fixture_description == "the fixture description"

    def test_an_http_error_raises_case_list_fetch_error(self):
        client = _FakeHttpClient(_response(status_code=404))
        reader = GithubChatCaseListReader(client=client)
        with pytest.raises(CaseListFetchError):
            reader.read("campaign_assistant")

    def test_non_json_body_raises_case_list_fetch_error(self):
        request = httpx.Request("GET", "https://raw.githubusercontent.com/x")
        response = httpx.Response(status_code=200, content=b"not json", request=request)
        reader = GithubChatCaseListReader(client=_FakeHttpClient(response))
        with pytest.raises(CaseListFetchError):
            reader.read("campaign_assistant")


class TestFakeChatCaseListReader:
    def test_returns_the_configured_info(self):
        info = CaseListInfo(
            agent_id="chief_of_staff", case_count=5, case_ids=frozenset(), conditions=("c",), fixture_description="d"
        )
        reader = FakeChatCaseListReader({"chief_of_staff": info})
        assert reader.read("chief_of_staff") is info

    def test_unconfigured_agent_returns_empty(self):
        reader = FakeChatCaseListReader()
        assert reader.read("chief_of_staff") == CaseListInfo.empty("chief_of_staff")
