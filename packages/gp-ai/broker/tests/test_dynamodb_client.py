import json
import time
from unittest.mock import MagicMock

import boto3
import pytest
from moto import mock_aws

from broker.dynamodb_client import (
    ExperimentOverrideRef,
    InputFileRef,
    JudgeReplayRef,
    ScopeTicket,
    ScopeTicketStore,
    TicketAlreadyExistsError,
)


@pytest.fixture
def moto_ddb():
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-west-2")
        client.create_table(
            TableName="scope-tickets",
            AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield client


def _make_ticket(
    pk: str = "broker-token-abc",
    exp_offset: int = 3600,
    **overrides,
) -> ScopeTicket:
    now = int(time.time())
    defaults = {
        "pk": pk,
        "run_id": "run-001",
        "organization_slug": "org-42",
        "experiment_id": "voter_targeting",
        "scope": {"databricks": ["SELECT"]},
        "params": {"state": "CA", "district": "SD-15"},
        "exp": now + exp_offset,
        "issued_at": now,
        "issued_by": "dispatch-lambda",
    }
    defaults.update(overrides)
    return ScopeTicket(**defaults)


def _mock_dynamodb_client():
    return MagicMock()


class TestScopeTicketModel:
    def test_prior_artifact_versions_optional(self):
        ticket = _make_ticket()
        assert ticket.prior_artifact_versions is None

    def test_prior_artifact_versions_set(self):
        ticket = _make_ticket(prior_artifact_versions={"district_intel": "v2"})
        assert ticket.prior_artifact_versions == {"district_intel": "v2"}

    def test_input_files_optional(self):
        ticket = _make_ticket()
        assert ticket.input_files is None

    def test_input_files_set(self):
        refs = [InputFileRef(bucket="gp-agent-run-inputs-dev", key="u/abc", dest="agenda.pdf")]
        ticket = _make_ticket(input_files=refs)
        assert ticket.input_files == refs


class TestInputFileRefValidation:
    def test_dest_rejects_separator(self):
        with pytest.raises(ValueError):
            InputFileRef(bucket="b", key="k", dest="sub/file.pdf")

    def test_dest_rejects_parent_ref(self):
        with pytest.raises(ValueError):
            InputFileRef(bucket="b", key="k", dest="..")

    def test_dest_rejects_leading_dot(self):
        with pytest.raises(ValueError):
            InputFileRef(bucket="b", key="k", dest=".hidden")

    def test_dest_rejects_empty(self):
        with pytest.raises(ValueError):
            InputFileRef(bucket="b", key="k", dest="")

    def test_dest_accepts_typical_filename(self):
        ref = InputFileRef(bucket="b", key="k", dest="agenda.pdf")
        assert ref.dest == "agenda.pdf"


class TestPutAndGetRoundTrip:
    def test_put_then_get_returns_ticket(self):
        mock_client = _mock_dynamodb_client()
        mock_client.transact_write_items.return_value = {}

        ticket = _make_ticket()
        store = ScopeTicketStore("scope-tickets", dynamodb_client=mock_client)
        store.put_ticket(ticket)

        mock_client.transact_write_items.assert_called_once()
        transact_items = mock_client.transact_write_items.call_args[1]["TransactItems"]
        assert len(transact_items) == 2
        assert transact_items[0]["Put"]["TableName"] == "scope-tickets"
        assert transact_items[0]["Put"]["Item"]["pk"]["S"] == ticket.pk
        assert transact_items[1]["Put"]["Item"]["pk"]["S"] == f"run:{ticket.run_id}"

        mock_client.get_item.return_value = {
            "Item": {
                "pk": {"S": ticket.pk},
                "run_id": {"S": ticket.run_id},
                "organization_slug": {"S": ticket.organization_slug},
                "experiment_id": {"S": ticket.experiment_id},
                "scope": {
                    "S": ticket.scope.model_dump_json()
                    if hasattr(ticket.scope, "model_dump_json")
                    else __import__("json").dumps(ticket.scope)
                },
                "params": {"S": __import__("json").dumps(ticket.params)},
                "exp": {"N": str(ticket.exp)},
                "issued_at": {"N": str(ticket.issued_at)},
                "issued_by": {"S": ticket.issued_by},
            }
        }

        result = store.get_ticket(ticket.pk)
        assert result is not None
        assert result.pk == ticket.pk
        assert result.run_id == ticket.run_id
        assert result.organization_slug == ticket.organization_slug
        assert result.experiment_id == ticket.experiment_id
        assert result.scope == ticket.scope
        assert result.params == ticket.params


class TestGetMissing:
    def test_get_returns_none_for_missing_token(self):
        mock_client = _mock_dynamodb_client()
        mock_client.get_item.return_value = {}

        store = ScopeTicketStore("scope-tickets", dynamodb_client=mock_client)
        result = store.get_ticket("nonexistent-token")
        assert result is None


class TestGetExpired:
    def test_get_returns_none_for_expired_ticket(self):
        mock_client = _mock_dynamodb_client()
        expired_ticket = _make_ticket(exp_offset=-3600)

        mock_client.get_item.return_value = {
            "Item": {
                "pk": {"S": expired_ticket.pk},
                "run_id": {"S": expired_ticket.run_id},
                "organization_slug": {"S": expired_ticket.organization_slug},
                "experiment_id": {"S": expired_ticket.experiment_id},
                "scope": {"S": __import__("json").dumps(expired_ticket.scope)},
                "params": {"S": __import__("json").dumps(expired_ticket.params)},
                "exp": {"N": str(expired_ticket.exp)},
                "issued_at": {"N": str(expired_ticket.issued_at)},
                "issued_by": {"S": expired_ticket.issued_by},
            }
        }

        store = ScopeTicketStore("scope-tickets", dynamodb_client=mock_client)
        result = store.get_ticket(expired_ticket.pk)
        assert result is None


class TestPutDuplicate:
    def test_put_raises_ticket_already_exists_on_transaction_cancelled(self):
        mock_client = _mock_dynamodb_client()
        from botocore.exceptions import ClientError

        mock_client.transact_write_items.side_effect = ClientError(
            {
                "Error": {
                    "Code": "TransactionCanceledException",
                    "Message": "Transaction cancelled",
                },
                "CancellationReasons": [
                    {"Code": "None"},
                    {"Code": "ConditionalCheckFailed"},
                ],
            },
            "TransactWriteItems",
        )

        ticket = _make_ticket()
        store = ScopeTicketStore("scope-tickets", dynamodb_client=mock_client)

        with pytest.raises(TicketAlreadyExistsError):
            store.put_ticket(ticket)


class TestDelete:
    def test_delete_calls_delete_item(self):
        mock_client = _mock_dynamodb_client()
        mock_client.delete_item.return_value = {}

        store = ScopeTicketStore("scope-tickets", dynamodb_client=mock_client)
        store.delete_ticket("broker-token-abc")

        mock_client.delete_item.assert_called_once_with(
            TableName="scope-tickets",
            Key={"pk": {"S": "broker-token-abc"}},
        )


class TestRunIdIdempotency:
    def test_put_ticket_writes_run_lock_item(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        ticket = _make_ticket(pk="token-xyz", run_id="run-ABC")

        store.put_ticket(ticket)

        run_lock = moto_ddb.get_item(
            TableName="scope-tickets",
            Key={"pk": {"S": "run:run-ABC"}},
        )
        assert "Item" in run_lock
        assert run_lock["Item"]["run_id"]["S"] == "run-ABC"
        assert run_lock["Item"]["broker_token"]["S"] == "token-xyz"
        assert int(run_lock["Item"]["exp"]["N"]) == ticket.exp

    def test_mint_rejects_duplicate_run_id(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        first = _make_ticket(pk="token-1", run_id="run-DUPLICATE")
        second = _make_ticket(pk="token-2", run_id="run-DUPLICATE")

        store.put_ticket(first)

        with pytest.raises(TicketAlreadyExistsError):
            store.put_ticket(second)

        second_ticket = moto_ddb.get_item(
            TableName="scope-tickets",
            Key={"pk": {"S": "token-2"}},
        )
        assert "Item" not in second_ticket

    def test_mint_allows_new_run_id_after_expiry(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        expired = _make_ticket(pk="token-old", run_id="run-REUSED", exp_offset=-60)
        fresh = _make_ticket(pk="token-new", run_id="run-REUSED")

        store.put_ticket(expired)
        store.put_ticket(fresh)

        run_lock = moto_ddb.get_item(
            TableName="scope-tickets",
            Key={"pk": {"S": "run:run-REUSED"}},
        )
        assert run_lock["Item"]["broker_token"]["S"] == "token-new"

    def test_get_ticket_rejects_run_lock_prefix(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        ticket = _make_ticket(pk="token-real", run_id="run-GUARD")
        store.put_ticket(ticket)

        assert store.get_ticket("run:run-GUARD") is None

    def test_delete_ticket_and_run_lock_removes_both(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        ticket = _make_ticket(pk="token-del", run_id="run-DEL")
        store.put_ticket(ticket)

        store.delete_ticket_and_run_lock("token-del", "run-DEL")

        ticket_row = moto_ddb.get_item(
            TableName="scope-tickets",
            Key={"pk": {"S": "token-del"}},
        )
        run_lock = moto_ddb.get_item(
            TableName="scope-tickets",
            Key={"pk": {"S": "run:run-DEL"}},
        )
        assert "Item" not in ticket_row
        assert "Item" not in run_lock

    def test_delete_then_remint_same_run_id_succeeds(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        first = _make_ticket(pk="token-1", run_id="run-RETRY")
        store.put_ticket(first)
        store.delete_ticket_and_run_lock("token-1", "run-RETRY")

        retry = _make_ticket(pk="token-2", run_id="run-RETRY")
        store.put_ticket(retry)

        run_lock = moto_ddb.get_item(
            TableName="scope-tickets",
            Key={"pk": {"S": "run:run-RETRY"}},
        )
        assert run_lock["Item"]["broker_token"]["S"] == "token-2"


class TestInputFilesRoundTrip:
    def test_input_files_roundtrip_through_dynamodb(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        refs = [
            InputFileRef(
                bucket="gp-agent-run-inputs-dev",
                key="uploads/org/abc/agenda.pdf",
                dest="agenda.pdf",
            ),
            InputFileRef(
                bucket="gp-agent-run-inputs-dev",
                key="uploads/org/abc/appendix.pdf",
                dest="appendix.pdf",
            ),
        ]
        ticket = _make_ticket(pk="token-if", run_id="run-IF", input_files=refs)

        store.put_ticket(ticket)

        result = store.get_ticket("token-if")
        assert result is not None
        assert result.input_files == refs

    def test_input_files_absent_roundtrip(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        ticket = _make_ticket(pk="token-noif", run_id="run-NOIF")

        store.put_ticket(ticket)

        result = store.get_ticket("token-noif")
        assert result is not None
        assert result.input_files is None


class TestJudgeFieldsRoundTrip:
    def test_defaults_are_off(self):
        ticket = _make_ticket()
        assert ticket.is_eval is False
        assert ticket.experiment_override is None

    def test_no_judge_fields_writes_no_extra_attributes(self, moto_ddb):
        """The item a product run's ticket writes must be exactly what it
        writes today — the judge attributes only appear when set."""
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        store.put_ticket(_make_ticket(pk="token-plain", run_id="run-PLAIN"))

        item = moto_ddb.get_item(TableName="scope-tickets", Key={"pk": {"S": "token-plain"}})["Item"]
        assert "is_eval" not in item
        assert "experiment_override" not in item

        result = store.get_ticket("token-plain")
        assert result is not None
        assert result.is_eval is False
        assert result.experiment_override is None

    def test_judge_fields_roundtrip_through_dynamodb(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        override = ExperimentOverrideRef(
            manifest_key="_judge/voter_targeting/abc123/manifest.json",
            instruction_key="_judge/voter_targeting/abc123/instruction.md",
            manifest_version_id="override-m-1",
            instruction_version_id="override-i-1",
        )
        ticket = _make_ticket(
            pk="token-judge",
            run_id="_judge-run-001",
            is_eval=True,
            experiment_override=override,
        )

        store.put_ticket(ticket)

        result = store.get_ticket("token-judge")
        assert result is not None
        assert result.is_eval is True
        assert result.experiment_override == override

    def test_override_without_the_eval_flag_is_refused(self):
        """An override only ever comes from a judge dispatch, which has no
        gp-api run row — so a ticket carrying one must also suppress the
        callback, and a mismatch is a wiring bug worth failing at mint."""
        with pytest.raises(ValueError):
            _make_ticket(
                is_eval=False,
                experiment_override=ExperimentOverrideRef(
                    manifest_key="_judge/voter_targeting/abc123/manifest.json",
                    instruction_key="_judge/voter_targeting/abc123/instruction.md",
                    manifest_version_id="override-m-1",
                    instruction_version_id="override-i-1",
                ),
            )

    def test_eval_flag_is_independent_of_the_override(self, moto_ddb):
        """A sweep's base arm runs the published bytes with no override, and
        its callback still has to be suppressed."""
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        store.put_ticket(_make_ticket(pk="token-base-arm", run_id="_judge-base-001", is_eval=True))

        result = store.get_ticket("token-base-arm")
        assert result is not None
        assert result.is_eval is True
        assert result.experiment_override is None


class TestJudgeContractAgreement:
    """The judge key shape, the run-id prefix and the VersionId alphabet are
    each written down more than once — in this module, in the dispatch Lambda
    (a separate deployable with no import path to here), in the broker's own
    request models, and in `packages/contracts` (TypeScript). Nothing but a
    test holds them in agreement, so a rename on one side would otherwise pass
    both suites green."""

    def test_key_regex_matches_the_dispatch_lambdas(self):
        from broker.dynamodb_client import JUDGE_OVERRIDE_KEY_RE as broker_re
        from pmf_engine.control_plane.manifest_loader import JUDGE_OVERRIDE_KEY_RE as lambda_re

        assert broker_re.pattern == lambda_re.pattern

    def test_run_id_prefix_matches_the_dispatch_lambdas(self):
        from broker.dynamodb_client import JUDGE_RUN_ID_PREFIX as broker_prefix
        from pmf_engine.control_plane.manifest_loader import JUDGE_RUN_ID_PREFIX as lambda_prefix

        # Also pinned literally, because the two could drift together away from
        # the value `packages/contracts` publishes to a future TypeScript
        # producer.
        assert broker_prefix == lambda_prefix == "_judge-"

    def test_run_id_regex_matches_the_dispatch_lambdas(self):
        """The prefix is only half the shape. Mint `fullmatch`es this regex to
        refuse a judge run id the dispatch Lambda would refuse, so the two
        patterns drifting apart would silently reopen the gap: mint accepting a
        run id dispatch rejects, or rejecting one a real sweep arm uses."""
        from broker.dynamodb_client import JUDGE_RUN_ID_MAX_LENGTH as broker_max
        from broker.dynamodb_client import JUDGE_RUN_ID_RE as broker_re
        from pmf_engine.control_plane.manifest_loader import JUDGE_RUN_ID_MAX_LENGTH as lambda_max
        from pmf_engine.control_plane.manifest_loader import JUDGE_RUN_ID_RE as lambda_re

        assert broker_re.pattern == lambda_re.pattern
        # Also pinned literally: the two could drift together away from the 36
        # `packages/contracts` publishes as JUDGE_RUN_ID_MAX_LENGTH, which is
        # what the TypeScript producer sizes its run ids against.
        assert broker_max == lambda_max == 36

    def test_replay_key_regexes_match_the_dispatch_lambdas(self):
        """The dispatch Lambda refuses a `_judge_replay` the broker would
        refuse at mint, so a dispatch fails before it queues a job. Drift
        would either queue runs that mint then rejects, or refuse keys the
        judge really builds."""
        from broker.dynamodb_client import JUDGE_REPLAY_KEY_RES as broker_res
        from pmf_engine.control_plane.manifest_loader import JUDGE_REPLAY_KEY_RES as lambda_res

        assert {k: r.pattern for k, r in broker_res.items()} == {k: r.pattern for k, r in lambda_res.items()}

    def test_version_id_alphabet_matches_the_request_models(self):
        from broker.dynamodb_client import _S3_VERSION_ID_RE
        from broker.endpoints.experiment_manifest import S3_VERSION_ID_PATTERN

        assert _S3_VERSION_ID_RE.pattern == S3_VERSION_ID_PATTERN


class TestOverrideIsBoundToItsAgent:
    def test_an_override_for_another_agent_cannot_be_constructed(self):
        """Enforced on the ticket, not only in mint's write path, so a tampered
        or drifted DynamoDB item cannot be loaded either."""
        with pytest.raises(ValueError, match="does not match experiment_id"):
            _make_ticket(
                experiment_id="voter_targeting",
                is_eval=True,
                experiment_override=ExperimentOverrideRef(
                    manifest_key="_judge/walking_plan/abc123/manifest.json",
                    instruction_key="_judge/walking_plan/abc123/instruction.md",
                    manifest_version_id="override-m-1",
                    instruction_version_id="override-i-1",
                ),
            )

    def test_a_tampered_stored_item_cannot_be_read_back(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        store.put_ticket(_make_ticket(pk="token-tamper", run_id="_judge-run-t", is_eval=True))
        moto_ddb.update_item(
            TableName="scope-tickets",
            Key={"pk": {"S": "token-tamper"}},
            UpdateExpression="SET experiment_override = :o",
            ExpressionAttributeValues={
                ":o": {
                    "S": json.dumps(
                        {
                            "manifest_key": "_judge/walking_plan/abc123/manifest.json",
                            "instruction_key": "_judge/walking_plan/abc123/instruction.md",
                            "manifest_version_id": "override-m-1",
                            "instruction_version_id": "override-i-1",
                        }
                    )
                }
            },
        )

        with pytest.raises(ValueError, match="does not match experiment_id"):
            store.get_ticket("token-tamper")


SWEEP_KEY = "_judge/replay/sweep/judge-123-1/voter_targeting/t2-1"
BASE_KEY = "_judge/replay/base/voter_targeting/abc123/t2-1"
SEED_KEY = "_judge/replay/seed/voter_targeting/namesake"


class TestJudgeReplayRef:
    @pytest.mark.parametrize(
        "mode,key",
        [
            ("record", SWEEP_KEY),
            ("replay", SWEEP_KEY),
            ("record", BASE_KEY),
            ("replay", BASE_KEY),
            ("replay", SEED_KEY),
        ],
    )
    def test_accepts_each_store_layout(self, mode, key):
        assert JudgeReplayRef(mode=mode, key=key).agent_id == "voter_targeting"

    def test_a_seed_store_is_replay_only(self):
        """The bench owns the seed store. A run recording into it would mix
        live pages into planted ones."""
        with pytest.raises(ValueError, match="replay-only"):
            JudgeReplayRef(mode="record", key=SEED_KEY)

    # The same shapes `packages/contracts` (JudgeReplay.schema.test.ts)
    # refuses, plus the trailing newline Python's `$` would admit, so the
    # TypeScript builder and this check cannot drift apart unnoticed.
    @pytest.mark.parametrize(
        "key",
        [
            "_judge/replay/../manifest.json",
            "_judge/replay/sweep/s/../voter_targeting/t1-1",
            "_judge/replay/sweep/s//voter_targeting/t1-1",
            f"{SWEEP_KEY}/",
            f"/{SWEEP_KEY}",
            f"{SWEEP_KEY}\n",
            "_judge/replay/other/voter_targeting/t1",
            "_judge/voter_targeting/abc/manifest.json",
            "_judge/replay/sweep/s/voter_targeting/t1",
            f"{SEED_KEY}/x",
            f"_judge/replay/sweep/{'a' * 65}/voter_targeting/t1-1",
            f"_judge/replay/seed/voter_targeting/{'a' * 81}",
            "_judge/replay/sweep/s/voter_targeting/t1-0",
            "_judge/replay/sweep/s/voter_targeting/t1-100",
            "_judge/replay/sweep/s/voter_targeting/t1-01",
            "_judge/replay/seed/Voter_targeting/t1",
            f"_judge/replay/base/voter_targeting/{'a' * 65}/t1-1",
            "_judge/replay/base/voter_targeting//t1-1",
        ],
    )
    def test_refuses_a_key_outside_the_three_layouts(self, key):
        with pytest.raises(ValueError):
            JudgeReplayRef(mode="replay", key=key)

    def test_refuses_an_unknown_mode(self):
        with pytest.raises(ValueError):
            JudgeReplayRef(mode="write", key=SWEEP_KEY)

    def test_refuses_an_extra_field(self):
        with pytest.raises(ValueError):
            JudgeReplayRef(mode="replay", key=SWEEP_KEY, bucket="x")


class TestReplayOnTheTicket:
    def test_defaults_to_none(self):
        assert _make_ticket().replay is None

    def test_requires_the_eval_flag(self):
        with pytest.raises(ValueError, match="replay requires is_eval"):
            _make_ticket(replay=JudgeReplayRef(mode="replay", key=SWEEP_KEY))

    def test_is_bound_to_its_agent(self):
        with pytest.raises(ValueError, match="does not match experiment_id"):
            _make_ticket(
                run_id="_judge-run-r",
                is_eval=True,
                replay=JudgeReplayRef(mode="replay", key="_judge/replay/seed/walking_plan/t1"),
            )

    def test_roundtrips_through_dynamodb(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        replay = JudgeReplayRef(mode="record", key=SWEEP_KEY)
        store.put_ticket(_make_ticket(pk="token-replay", run_id="_judge-run-r", is_eval=True, replay=replay))

        result = store.get_ticket("token-replay")

        assert result is not None
        assert result.replay == replay

    def test_a_ticket_without_it_writes_no_attribute(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        store.put_ticket(_make_ticket(pk="token-no-replay", run_id="_judge-run-n", is_eval=True))

        item = moto_ddb.get_item(TableName="scope-tickets", Key={"pk": {"S": "token-no-replay"}})["Item"]

        assert "replay" not in item

    def test_a_ticket_minted_before_the_field_existed_still_loads(self, moto_ddb):
        """Tickets live in DynamoDB across the deploy that adds this field, so
        an item with no `replay` attribute, written by the old code, must load
        as a ticket with no replay."""
        now = int(time.time())
        moto_ddb.put_item(
            TableName="scope-tickets",
            Item={
                "pk": {"S": "token-old"},
                "run_id": {"S": "_judge-run-old"},
                "organization_slug": {"S": "org-42"},
                "experiment_id": {"S": "voter_targeting"},
                "scope": {"S": "{}"},
                "params": {"S": "{}"},
                "exp": {"N": str(now + 3600)},
                "issued_at": {"N": str(now)},
                "issued_by": {"S": "dispatch_lambda"},
                "is_eval": {"BOOL": True},
            },
        )

        result = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb).get_ticket("token-old")

        assert result is not None
        assert result.replay is None

    def test_a_tampered_stored_item_cannot_be_read_back(self, moto_ddb):
        store = ScopeTicketStore("scope-tickets", dynamodb_client=moto_ddb)
        store.put_ticket(_make_ticket(pk="token-tamper-r", run_id="_judge-run-tr", is_eval=True))
        moto_ddb.update_item(
            TableName="scope-tickets",
            Key={"pk": {"S": "token-tamper-r"}},
            UpdateExpression="SET replay = :r",
            ExpressionAttributeValues={
                ":r": {"S": json.dumps({"mode": "replay", "key": "_judge/replay/seed/walking_plan/t1"})}
            },
        )

        with pytest.raises(ValueError, match="does not match experiment_id"):
            store.get_ticket("token-tamper-r")
