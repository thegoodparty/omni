import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
import yaml

from serve.v1_pipeline.models.unified_record import ConsolidatedMessage
from serve.v1_pipeline.pipeline import orchestrator, sqs_publisher
from serve.v1_pipeline.pipeline.orchestrator import V1PipelineOrchestrator

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "pipeline_config.yaml"
POLL_GOLDEN_PATH = Path(__file__).resolve().parent / "fixtures" / "poll_golden.json"
QUEUE_URL = "https://sqs.us-west-2.amazonaws.com/123/test-queue.fifo"
OUTPUT_BUCKET = "serve-analyze-data-test"

POLL_CAMPAIGN = "pollcampaign"
POLL_CSV = """\
"Campaign ID","Campaign Name","Contact Phone Number","Carrier","Sent At","Message Text","round"
"0198cd60-856c","City of Berkley MI","+12484709513","VERIZON","2025-08-27T16:00:47.000Z","Side streets and roads are in horrible shape","R1"
"0198cd60-856c","City of Berkley MI","+12485619334","AT&T","2025-08-27T16:02:11.000Z","My road needs full pavement","R1"
"0198cd60-856c","City of Berkley MI","+12487211260","T-MOBILE","2025-08-27T16:05:30.000Z","We need a bigger park","R1"
"0198cd60-856c","City of Berkley MI","+12487211261","VERIZON","2025-08-27T16:06:02.000Z","The park closes too early, fix it","R1"
"0198cd60-856c","City of Berkley MI","+12484709513","VERIZON","2025-08-28T09:12:44.000Z","Also the road by the school","R2"
"0198cd60-856c","City of Berkley MI","+12489990000","VERIZON","2025-08-28T10:00:00.000Z","Property tax is too high","R2"
"0198cd60-856c","City of Berkley MI","+12481112222","AT&T","2025-08-28T10:30:00.000Z","STOP","R2"
"0198cd60-856c","City of Berkley MI","+12483334444","AT&T","2025-08-28T11:00:00.000Z","Thanks!","R2"
"""

FEEDBACK_SOURCE_TYPE = "constituent_feedback"
RUN_ID = "cmg8k2x0q0000abcd1234efgh"
ROADS_A = "3f2b8c1e-6a4d-4e2f-9b1a-0c7d5e8f9a01"
ROADS_B = "7a1c9e3b-2d5f-4b8a-8c6e-1f0a3b5d7c02"
ROADS_C = "ckz1x9q0d0000qz3k8m6h2v4p"
PARKS_A = "b5e7d2a9-8c3f-4a1b-9e6d-2c4f6a8b0d03"
PARKS_B = "e9c3a7f1-4b6d-4e8a-a2c5-3d7f9b1e5a04"
TAXES_A = "1d4f8b2c-9e5a-4c7b-b3d6-4e8a0c2f6b05"


def _feedback_csv(rows: list[tuple[str, str, str]]) -> str:
    def field_(value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

    lines = ["respondent_id,message_text,sent_at"]
    lines.extend(",".join(field_(value) for value in row) for row in rows)
    return "\n".join([*lines, ""])


FEEDBACK_ROWS = [
    (ROADS_A, "The roads are full of potholes", "2026-09-30T14:05:00Z"),
    (PARKS_A, "We need a new park on the east side", "2026-09-30T14:07:00Z"),
    (ROADS_B, 'She said "fix the road", twice\nand then left', "2026-09-30T14:09:00Z"),
    (TAXES_A, "Property tax went up again", "2026-09-30T14:11:00Z"),
    (PARKS_B, "The park closes too early", "2026-09-30T14:13:00Z"),
    (ROADS_C, "Road repairs never reach our block", "2026-09-30T14:15:00Z"),
]

THEMES = [("road", 1, "Roads"), ("park", 2, "Parks"), ("tax", 3, "Taxes")]


@dataclass
class _KeywordClusterer:
    received: list[ConsolidatedMessage] = field(default_factory=list)

    async def process_messages(
        self,
        messages: list[ConsolidatedMessage],
        campaign_name: str = "temp",
        persistent_output_dir: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        self.received.extend(messages)
        assignments: list[tuple[ConsolidatedMessage, int, str, bool]] = []
        for message in messages:
            text = message.message_text.lower()
            is_opt_out = text.strip() == "stop"
            cluster_id, theme = next(
                ((cid, name) for keyword, cid, name in THEMES if keyword in text),
                (-1, "Uncategorized"),
            )
            assignments.append((message, cluster_id, theme, is_opt_out))

        quotes: dict[int, list[dict[str, str]]] = {}
        for message, cluster_id, _, is_opt_out in assignments:
            if cluster_id != -1 and not is_opt_out and len(quotes.setdefault(cluster_id, [])) < 2:
                quotes[cluster_id].append({"quote": message.message_text, "phone_number": message.phone_number})

        results: dict[str, dict[str, Any]] = {}
        for index, (message, cluster_id, theme, is_opt_out) in enumerate(assignments):
            atomic_id = f"atomic-{index:03d}"
            cluster_data = (
                {}
                if is_opt_out
                else {
                    "15": {
                        "cluster_id": cluster_id,
                        "cluster_theme": theme,
                        "cluster_category": "Infrastructure",
                        "issues_summary": f"Summary for {theme}",
                        "cluster_sentiment": "negative",
                        "detailed_analysis": f"Analysis for {theme}",
                        "quotes": quotes.get(cluster_id, []),
                    }
                }
            )
            results[atomic_id] = {
                "atomic_id": atomic_id,
                "phone_number": message.phone_number,
                "cluster_data": cluster_data,
                "message": message.message_text,
                "atomic_message": message.message_text,
                "is_opt_out": is_opt_out,
            }
        return results


@dataclass
class _AwsRecorder:
    s3_puts: list[dict[str, Any]] = field(default_factory=list)
    sqs_messages: list[dict[str, Any]] = field(default_factory=list)

    def _put_object(self, **kwargs: Any) -> dict[str, Any]:
        self.s3_puts.append(kwargs)
        return {}

    def _send_message(self, **kwargs: Any) -> dict[str, Any]:
        self.sqs_messages.append(kwargs)
        return {"MessageId": f"message-{len(self.sqs_messages)}"}

    def client(self, service_name: str, region_name: str | None = None) -> MagicMock:
        fake = MagicMock()
        fake.put_object.side_effect = self._put_object
        fake.send_message.side_effect = self._send_message
        return fake


@dataclass
class _Run:
    aws: _AwsRecorder
    clusterer: _KeywordClusterer
    output_dir: Path


async def _run_pipeline(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    campaign_name: str,
    csv_text: str,
    env: dict[str, str],
) -> _Run:
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    (input_dir / f"{campaign_name}.csv").write_text(csv_text)
    output_dir = tmp_path / "output" / "consolidated"

    config = yaml.safe_load(CONFIG_PATH.read_text())
    config["consolidation"]["input_dir"] = str(input_dir)
    config["consolidation"]["output_dir"] = str(output_dir)
    config_path = tmp_path / "pipeline_config.yaml"
    config_path.write_text(yaml.safe_dump(config))

    for name in ("SOURCE_TYPE", "SOURCE_ID", "PUBLISH_TOP_N"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("S3_OUTPUT_BUCKET", OUTPUT_BUCKET)
    monkeypatch.setenv("SQS_QUEUE_URL", QUEUE_URL)
    monkeypatch.setenv("S3_OUTPUT_PATH", f"s3://{OUTPUT_BUCKET}/output/{campaign_name}/1700000000000/")
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    aws = _AwsRecorder()
    monkeypatch.setattr(sqs_publisher.boto3, "client", aws.client)
    clusterer = _KeywordClusterer()
    monkeypatch.setattr(orchestrator, "ClusteringAdapter", lambda: clusterer)

    result = await V1PipelineOrchestrator(str(config_path)).run_pipeline(campaign_name)
    assert result.errors == []
    return _Run(aws=aws, clusterer=clusterer, output_dir=output_dir)


def _poll_outputs(run: _Run) -> dict[str, Any]:
    events_files = sorted((run.output_dir / "events").glob("events_*.json"))
    assert len(events_files) == 1
    return {
        "cluster_analysis_csv": (run.output_dir / f"{POLL_CAMPAIGN}_all_cluster_analysis.csv").read_bytes().decode(),
        "s3_puts": [
            {"Bucket": put["Bucket"], "Key": put["Key"], "Body": put["Body"].decode()} for put in run.aws.s3_puts
        ],
        "sqs_messages": [
            {name: message[name] for name in ("QueueUrl", "MessageGroupId", "MessageBody")}
            for message in run.aws.sqs_messages
        ],
        "events_file": events_files[0].read_bytes().decode(),
    }


def _only_event(run: _Run) -> dict[str, Any]:
    assert len(run.aws.sqs_messages) == 1
    body: dict[str, Any] = json.loads(run.aws.sqs_messages[0]["MessageBody"])
    return body


def _feedback_env(top_n: int = 10) -> dict[str, str]:
    return {"SOURCE_TYPE": FEEDBACK_SOURCE_TYPE, "SOURCE_ID": RUN_ID, "PUBLISH_TOP_N": str(top_n)}


class TestPollSourceUnchanged:
    @pytest.mark.asyncio
    async def test_poll_outputs_are_byte_identical_to_the_recorded_run(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run = await _run_pipeline(tmp_path, monkeypatch, POLL_CAMPAIGN, POLL_CSV, env={})

        assert _poll_outputs(run) == json.loads(POLL_GOLDEN_PATH.read_text())


class TestFeedbackSource:
    @pytest.mark.asyncio
    async def test_respondent_ids_reach_clustering_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run = await _run_pipeline(tmp_path, monkeypatch, RUN_ID, _feedback_csv(FEEDBACK_ROWS), _feedback_env())

        assert [message.phone_number for message in run.clusterer.received] == [row[0] for row in FEEDBACK_ROWS]
        assert [message.message_text for message in run.clusterer.received] == [row[1] for row in FEEDBACK_ROWS]

    @pytest.mark.asyncio
    async def test_numeric_looking_respondent_ids_stay_text(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        rows = [
            ("0042", "The road is cracked", "2026-09-30T14:05:00Z"),
            ("0043", "Road crews never come", "2026-09-30T14:06:00Z"),
        ]
        run = await _run_pipeline(tmp_path, monkeypatch, RUN_ID, _feedback_csv(rows), _feedback_env())

        assert [message.phone_number for message in run.clusterer.received] == ["0042", "0043"]
        assert _only_event(run)["data"]["issues"][0]["memberIds"] == ["0042", "0043"]

    @pytest.mark.asyncio
    async def test_publishes_the_feedback_completion_event(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run = await _run_pipeline(tmp_path, monkeypatch, RUN_ID, _feedback_csv(FEEDBACK_ROWS), _feedback_env())

        assert _only_event(run) == {
            "type": "feedbackSynthesisComplete",
            "data": {
                "sourceType": FEEDBACK_SOURCE_TYPE,
                "sourceId": RUN_ID,
                "totalResponses": 6,
                "responsesLocation": None,
                "issues": [
                    {
                        "rank": 1,
                        "theme": "Roads",
                        "summary": "Summary for Roads",
                        "analysis": "Analysis for Roads",
                        "responseCount": 3,
                        "quotes": [
                            {"quote": "The roads are full of potholes", "respondent_id": ROADS_A},
                            {"quote": 'She said "fix the road", twice\nand then left', "respondent_id": ROADS_B},
                        ],
                        "memberIds": sorted([ROADS_A, ROADS_B, ROADS_C]),
                    },
                    {
                        "rank": 2,
                        "theme": "Parks",
                        "summary": "Summary for Parks",
                        "analysis": "Analysis for Parks",
                        "responseCount": 2,
                        "quotes": [
                            {"quote": "We need a new park on the east side", "respondent_id": PARKS_A},
                            {"quote": "The park closes too early", "respondent_id": PARKS_B},
                        ],
                        "memberIds": sorted([PARKS_A, PARKS_B]),
                    },
                ],
            },
        }

    @pytest.mark.asyncio
    async def test_a_theme_one_respondent_raised_is_not_published(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run = await _run_pipeline(tmp_path, monkeypatch, RUN_ID, _feedback_csv(FEEDBACK_ROWS), _feedback_env())

        themes = [issue["theme"] for issue in _only_event(run)["data"]["issues"]]
        assert "Taxes" not in themes

    @pytest.mark.asyncio
    async def test_publishes_at_most_the_requested_number_of_themes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run = await _run_pipeline(tmp_path, monkeypatch, RUN_ID, _feedback_csv(FEEDBACK_ROWS), _feedback_env(top_n=1))

        assert [issue["theme"] for issue in _only_event(run)["data"]["issues"]] == ["Roads"]

    @pytest.mark.asyncio
    async def test_sends_on_the_feedback_message_group_without_uploading_rows(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run = await _run_pipeline(tmp_path, monkeypatch, RUN_ID, _feedback_csv(FEEDBACK_ROWS), _feedback_env())

        assert run.aws.sqs_messages[0]["QueueUrl"] == QUEUE_URL
        assert run.aws.sqs_messages[0]["MessageGroupId"] == f"feedback-{RUN_ID}"
        assert run.aws.s3_puts == []

    @pytest.mark.asyncio
    async def test_an_empty_file_still_completes_the_run(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        run = await _run_pipeline(tmp_path, monkeypatch, RUN_ID, _feedback_csv([]), _feedback_env())

        event = _only_event(run)
        assert event["type"] == "feedbackSynthesisComplete"
        assert event["data"]["sourceId"] == RUN_ID
        assert event["data"]["totalResponses"] == 0
        assert event["data"]["issues"] == []
