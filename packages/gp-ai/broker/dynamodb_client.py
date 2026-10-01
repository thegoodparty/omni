import json
import re
import time
from typing import Any

import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel, ConfigDict, Field, model_validator

RUN_LOCK_PK_PREFIX = "run:"

# The content-addressed folder a judge sweep stages a candidate branch's
# manifest + instruction into: `_judge/<agentId>/<configDigest>/`. Each
# segment is [A-Za-z0-9_-]{1,64} and the basenames are fixed, so an override
# can only ever name those two objects under that one prefix — it can never
# point at `<experiment_id>/manifest.json`, at another experiment's folder, or
# at anything else in the metadata bucket. This regex is what makes that true;
# nothing about the bucket's IAM restricts the sweep's writes to `_judge/*`
# today, so the containment is entirely this check plus the ticket allowlist.
# One regex with named groups rather than one per leaf, so the folder-identity
# check below has segments to compare; it is the same shape the dispatch
# Lambda validates against
# (`pmf_engine/control_plane/manifest_loader.JUDGE_OVERRIDE_KEY_RE`).
JUDGE_OVERRIDE_KEY_RE = re.compile(
    r"^_judge/(?P<agent_id>[A-Za-z0-9_-]{1,64})/(?P<digest>[A-Za-z0-9_-]{1,64})/(?P<leaf>manifest\.json|instruction\.md)$"
)

# Every run id a judge sweep dispatches carries this prefix; it is the marker
# for "gp-api has no experiment_run row for this run". Duplicated from
# `packages/contracts` (TypeScript) and
# `pmf_engine/control_plane/manifest_loader.py` (a separate deployable) because
# there is no import path between the three; the agreement is held by tests.
JUDGE_RUN_ID_PREFIX = "_judge-"

# The rest of the judge run-id shape, duplicated from the same two places for
# the same reason. The dispatch Lambda refuses any judge run id that is not a
# `fullmatch` for this, so a mint that accepted a longer one would hand out a
# ticket for a run the layer above it will not dispatch — and the run id is
# also what dispatch passes to ECS RunTask as `startedBy` and what the task
# reaper reads back to identify the run. Product run ids are UUIDv7 (exactly
# 36), which is where the number comes from.
JUDGE_RUN_ID_MAX_LENGTH = 36

# `fullmatch` on an explicit alphabet rather than `startswith` + a length test,
# so the broker re-establishes the dispatch Lambda's whole run-id shape rather
# than a weaker approximation of it. (The broker's own `IDENTIFIER_PATTERN`
# already rejects the trailing newline Python's `$` would admit, because
# pydantic matches with the Rust regex engine — but this regex is read by
# Python's `re`, so the explicit `{1,N}` bound is what holds.)
JUDGE_RUN_ID_RE = re.compile(
    rf"^{JUDGE_RUN_ID_PREFIX}[A-Za-z0-9_-]{{1,{JUDGE_RUN_ID_MAX_LENGTH - len(JUDGE_RUN_ID_PREFIX)}}}$"
)

# Same alphabet the broker's own request models accept for an S3 VersionId
# (`experiment_manifest.S3_VERSION_ID_PATTERN`).
_S3_VERSION_ID_RE = re.compile(r"^[A-Za-z0-9._\-]{1,1024}$")


def _run_lock_pk(run_id: str) -> str:
    return f"{RUN_LOCK_PK_PREFIX}{run_id}"


class TicketAlreadyExistsError(Exception):
    pass


class InputFileRef(BaseModel):
    bucket: str = Field(..., min_length=1, max_length=255)
    key: str = Field(..., min_length=1, max_length=1024)
    # Path-traversal defense: dest is written under /workspace/input/<dest>,
    # so it must be a simple filename — no separators, no parent refs, no
    # leading dot (which would mark a hidden file the agent's directory
    # walks could miss).
    dest: str = Field(..., pattern=r"^[A-Za-z0-9_][A-Za-z0-9._-]*$", max_length=255)


class ExperimentOverrideRef(BaseModel):
    """The one key pair a judge run is allowed to read instead of its real
    experiment's manifest + instruction, pinned to exact S3 object versions.

    Mirrors `InputFileRef`: the ticket is already the authorization object for
    a run, so the allowlist rides on it and `/experiment/manifest` reads the
    keys from here, never from the request body. `_judge/` is a prefix the
    publish pipeline never writes under, so a key outside it means a bug or an
    attempt to read an unrelated object — either way, refuse it at parse time.
    Note that this is the enforcement, not a restatement of one: no IAM policy
    confines the sweep's writes to `_judge/*`, so nothing else is checking.

    The two VersionIds are required, not optional. Dispatch vets the override
    manifest's contents and the broker reads the same object minutes later;
    unpinned, anyone who can write the key could swap the bytes in between and
    the behavior allowlist would have vetted something the agent never runs.
    An unversioned or version-suspended bucket therefore has to fail at
    dispatch rather than degrade to "latest" here.
    """

    # An unrecognised field here would be a contract drift between the
    # dispatch Lambda and the broker that silently dropped whatever it named.
    model_config = ConfigDict(extra="forbid")

    manifest_key: str = Field(..., min_length=1, max_length=1024)
    instruction_key: str = Field(..., min_length=1, max_length=1024)
    manifest_version_id: str = Field(..., min_length=1, max_length=1024)
    instruction_version_id: str = Field(..., min_length=1, max_length=1024)

    @model_validator(mode="after")
    def _validate_key_pair(self) -> "ExperimentOverrideRef":
        # fullmatch via an anchored regex, not pydantic's `pattern=` — these
        # are S3 keys on a security boundary and `pattern` matches unanchored.
        matches = {}
        for field, leaf in (("manifest_key", "manifest.json"), ("instruction_key", "instruction.md")):
            match = JUDGE_OVERRIDE_KEY_RE.fullmatch(getattr(self, field))
            if match is None or match.group("leaf") != leaf:
                raise ValueError(f"{field} must be _judge/<agentId>/<configDigest>/{leaf}")
            matches[field] = match
        if matches["manifest_key"].group("agent_id") != matches["instruction_key"].group("agent_id") or matches[
            "manifest_key"
        ].group("digest") != matches["instruction_key"].group("digest"):
            # Two keys from different folders would let a ticket pair one
            # candidate's manifest with another's instruction.
            raise ValueError("manifest_key and instruction_key must name the same _judge/<agentId>/<configDigest>/")
        for field in ("manifest_version_id", "instruction_version_id"):
            if not _S3_VERSION_ID_RE.fullmatch(getattr(self, field)):
                raise ValueError(f"{field} is not a valid S3 VersionId")
        return self

    @property
    def agent_id(self) -> str:
        """The `<agentId>` segment both keys share. Callers bind it to the
        ticket's experiment_id so an override can only belong to its own agent.

        A plain split rather than a second regex match: `_validate_key_pair`
        has already established that the key is exactly
        `_judge/<agentId>/<digest>/<leaf>`, so there is no failure mode left
        here to write a branch for.
        """
        return self.manifest_key.split("/")[1]


class ScopeTicket(BaseModel):
    pk: str
    run_id: str
    organization_slug: str
    experiment_id: str
    scope: dict
    params: dict
    exp: int
    issued_at: int
    issued_by: str
    prior_artifact_versions: dict[str, str] | None = None
    clerk_user_id: str | None = None
    input_files: list[InputFileRef] | None = None
    # Universal Judge. `is_eval` marks a run gp-api has no `experiment_run`
    # row for, so the results callback must never be sent (a stray one makes
    # gp-api log `Experiment run not found` once per run). It is separate from
    # `experiment_override` on purpose: a sweep's base arm runs the published
    # bytes with no override at all, and its callback has to be suppressed too.
    is_eval: bool = False
    experiment_override: ExperimentOverrideRef | None = None

    @model_validator(mode="after")
    def _override_implies_eval(self) -> "ScopeTicket":
        # An override can only come from a judge dispatch, and a judge dispatch
        # has no gp-api run row. A ticket carrying one without `is_eval` would
        # therefore run branch bytes and then post a callback gp-api cannot
        # match — exactly the error storm the flag exists to prevent. Refuse it
        # at mint, before any money is spent, rather than discovering it as one
        # error per run.
        if self.experiment_override is not None and not self.is_eval:
            raise ValueError("experiment_override requires is_eval=True")
        # Bind the override to its own agent here rather than only in mint's
        # write path, so a tampered or drifted DynamoDB item cannot be LOADED
        # either. Without it, a ticket for experiment A could be handed
        # experiment B's staged candidate bytes.
        if self.experiment_override is not None and self.experiment_override.agent_id != self.experiment_id:
            raise ValueError(
                f"experiment_override agentId {self.experiment_override.agent_id!r} "
                f"does not match experiment_id {self.experiment_id!r}"
            )
        return self


class ScopeTicketStore:
    def __init__(self, table_name: str, dynamodb_client=None):
        self._table_name = table_name
        self._client = dynamodb_client or boto3.client("dynamodb")

    def put_ticket(self, ticket: ScopeTicket) -> None:
        item: dict[str, dict[str, Any]] = {
            "pk": {"S": ticket.pk},
            "run_id": {"S": ticket.run_id},
            "organization_slug": {"S": ticket.organization_slug},
            "experiment_id": {"S": ticket.experiment_id},
            "scope": {"S": json.dumps(ticket.scope)},
            "params": {"S": json.dumps(ticket.params)},
            "exp": {"N": str(ticket.exp)},
            "issued_at": {"N": str(ticket.issued_at)},
            "issued_by": {"S": ticket.issued_by},
        }
        if ticket.prior_artifact_versions is not None:
            item["prior_artifact_versions"] = {"S": json.dumps(ticket.prior_artifact_versions)}
        if ticket.clerk_user_id is not None:
            item["clerk_user_id"] = {"S": ticket.clerk_user_id}
        if ticket.input_files is not None:
            item["input_files"] = {"S": json.dumps([f.model_dump() for f in ticket.input_files])}
        # Written only when set, so a ticket for an ordinary product run puts
        # the exact same item attributes it does today.
        if ticket.is_eval:
            item["is_eval"] = {"BOOL": True}
        if ticket.experiment_override is not None:
            item["experiment_override"] = {"S": json.dumps(ticket.experiment_override.model_dump())}

        run_lock_item = {
            "pk": {"S": _run_lock_pk(ticket.run_id)},
            "run_id": {"S": ticket.run_id},
            "broker_token": {"S": ticket.pk},
            "exp": {"N": str(ticket.exp)},
        }

        now = int(time.time())
        try:
            self._client.transact_write_items(
                TransactItems=[
                    {
                        "Put": {
                            "TableName": self._table_name,
                            "Item": item,
                            "ConditionExpression": "attribute_not_exists(pk) OR exp < :now",
                            "ExpressionAttributeValues": {":now": {"N": str(now)}},
                        }
                    },
                    {
                        "Put": {
                            "TableName": self._table_name,
                            "Item": run_lock_item,
                            "ConditionExpression": "attribute_not_exists(pk) OR exp < :now",
                            "ExpressionAttributeValues": {":now": {"N": str(now)}},
                        }
                    },
                ]
            )
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("TransactionCanceledException", "ConditionalCheckFailedException"):
                raise TicketAlreadyExistsError(
                    f"Ticket already exists for pk={ticket.pk} or run_id={ticket.run_id}"
                ) from e
            raise

    def get_ticket(self, broker_token: str) -> ScopeTicket | None:
        if broker_token.startswith(RUN_LOCK_PK_PREFIX):
            return None
        response = self._client.get_item(
            TableName=self._table_name,
            Key={"pk": {"S": broker_token}},
        )
        item = response.get("Item")
        if not item:
            return None

        exp = int(item["exp"]["N"])
        if exp <= int(time.time()):
            return None

        prior = None
        if "prior_artifact_versions" in item:
            prior = json.loads(item["prior_artifact_versions"]["S"])

        clerk_user_id = None
        if "clerk_user_id" in item:
            clerk_user_id = item["clerk_user_id"]["S"]

        input_files = None
        if "input_files" in item:
            input_files = [InputFileRef(**f) for f in json.loads(item["input_files"]["S"])]

        is_eval = bool(item["is_eval"]["BOOL"]) if "is_eval" in item else False

        experiment_override = None
        if "experiment_override" in item:
            experiment_override = ExperimentOverrideRef(**json.loads(item["experiment_override"]["S"]))

        return ScopeTicket(
            pk=item["pk"]["S"],
            run_id=item["run_id"]["S"],
            organization_slug=item["organization_slug"]["S"],
            experiment_id=item["experiment_id"]["S"],
            scope=json.loads(item["scope"]["S"]),
            params=json.loads(item["params"]["S"]),
            exp=exp,
            issued_at=int(item["issued_at"]["N"]),
            issued_by=item["issued_by"]["S"],
            prior_artifact_versions=prior,
            clerk_user_id=clerk_user_id,
            input_files=input_files,
            is_eval=is_eval,
            experiment_override=experiment_override,
        )

    def delete_ticket(self, broker_token: str) -> None:
        self._client.delete_item(
            TableName=self._table_name,
            Key={"pk": {"S": broker_token}},
        )

    def delete_ticket_and_run_lock(self, broker_token: str, run_id: str) -> None:
        self._client.transact_write_items(
            TransactItems=[
                {
                    "Delete": {
                        "TableName": self._table_name,
                        "Key": {"pk": {"S": broker_token}},
                    }
                },
                {
                    "Delete": {
                        "TableName": self._table_name,
                        "Key": {"pk": {"S": _run_lock_pk(run_id)}},
                    }
                },
            ]
        )
