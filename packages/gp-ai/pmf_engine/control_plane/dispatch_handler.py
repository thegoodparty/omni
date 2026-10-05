from __future__ import annotations

import json
import os
import re

import boto3
import httpx
from jsonschema import Draft7Validator

_EXPERIMENT_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_IDENTIFIER_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

try:
    from shared.logger import get_logger

    logger = get_logger(__name__)
except (ImportError, OSError):
    import logging

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

try:
    from .broker_client import BrokerClient, BrokerError
    from .jsonschema_errors import format_validation_errors
    from .manifest_loader import (
        JUDGE_OVERRIDE_KEY_RE,
        JUDGE_RUN_ID_MAX_LENGTH,
        JUDGE_RUN_ID_PREFIX,
        JUDGE_RUN_ID_RE,
        ManifestLoaderError,
        ManifestLoaderMalformedError,
        ManifestLoaderTransientError,
        ManifestRoutingLoader,
    )
    from .scope_derivation import derive_scope
except ImportError:
    from broker_client import BrokerClient, BrokerError
    from jsonschema_errors import format_validation_errors  # type: ignore[no-redef]
    from manifest_loader import (  # type: ignore[no-redef]
        JUDGE_OVERRIDE_KEY_RE,
        JUDGE_RUN_ID_MAX_LENGTH,
        JUDGE_RUN_ID_PREFIX,
        JUDGE_RUN_ID_RE,
        ManifestLoaderError,
        ManifestLoaderMalformedError,
        ManifestLoaderTransientError,
        ManifestRoutingLoader,
    )
    from scope_derivation import derive_scope  # type: ignore[no-redef]

_ecs_client = None
_sqs_client = None
_cw_client = None
_secrets_client = None
_service_token: str | None = None
_manifest_loader: ManifestRoutingLoader | None = None
_broker_client: BrokerClient | None = None
_validator_cache: dict[str, Draft7Validator] = {}
_VALIDATOR_CACHE_MAX = 64

# Fields whose presence on a projected routing dict signals a write-action
# experiment. Mirrors manifest_loader._WRITE_ACTION_FIELDS minus
# `allowed_external_tools`, which is a tool-list a read-action experiment
# could plausibly carry (e.g. WebFetch on a Databricks experiment) and is
# therefore not a write-action signal on its own.
_WRITE_ACTION_DISCRIMINATORS = ("system_prompt", "permission_mode")


def _is_write_action(experiment: dict) -> bool:
    return any(experiment.get(f) is not None for f in _WRITE_ACTION_DISCRIMINATORS)


def _get_secrets_client():
    global _secrets_client
    if _secrets_client is None:
        _secrets_client = boto3.client("secretsmanager")
    return _secrets_client


def get_service_token() -> str:
    """Fetch the broker service token from Secrets Manager, cached per warm
    container. Reading at runtime keeps the secret out of Terraform state and
    out of lambda:GetFunctionConfiguration, unlike a plaintext env var. A
    fetch failure propagates so the launch/mint path treats it as transient."""
    global _service_token
    if _service_token is None:
        resp = _get_secrets_client().get_secret_value(SecretId=SERVICE_TOKENS_SECRET_ARN)
        _service_token = json.loads(resp["SecretString"])["SERVICE_TOKEN"]
    return _service_token


def reset_service_token_for_tests() -> None:
    global _service_token, _secrets_client
    _service_token = None
    _secrets_client = None


def get_broker_client() -> BrokerClient:
    """Process-cached BrokerClient. Safe across threads — BrokerClient holds
    only the URL + service token; httpx is invoked at module-level per call.
    """
    global _broker_client
    if _broker_client is None:
        _broker_client = BrokerClient(BROKER_URL, get_service_token())
    return _broker_client


def reset_broker_client_for_tests() -> None:
    global _broker_client
    _broker_client = None


def _input_validator(experiment_id: str, manifest_version_id: str | None, input_schema: dict) -> Draft7Validator:
    """Cached Draft7Validator per (experiment_id, manifest_version_id).

    Schema construction is non-trivial (refs/format-checker setup); reusing
    the validator across dispatch records is the win. New manifest version
    publishes get a new cache key so stale schemas can't linger.

    When `manifest_version_id is None` (unversioned bucket / publish-time
    drift), refuse to cache: a stale validator would persist forever in
    the warm Lambda. Build a fresh one each call instead.
    """
    if manifest_version_id is None:
        return Draft7Validator(input_schema)
    key = f"{experiment_id}:{manifest_version_id}"
    cached = _validator_cache.get(key)
    if cached is not None:
        return cached
    if len(_validator_cache) >= _VALIDATOR_CACHE_MAX:
        _validator_cache.clear()
    validator = Draft7Validator(input_schema)
    _validator_cache[key] = validator
    return validator


def reset_validator_cache_for_tests() -> None:
    _validator_cache.clear()


def get_manifest_loader() -> ManifestRoutingLoader:
    """Returns a process-cached ManifestRoutingLoader.

    EXPERIMENT_METADATA_BUCKET is required and validated upfront via
    `_missing_critical_config()` so a missing bucket triggers the per-message
    error-callback path (not an uncaught RuntimeError that crashes the batch).
    """
    global _manifest_loader
    if _manifest_loader is None:
        bucket = os.environ.get("EXPERIMENT_METADATA_BUCKET", "").strip()
        if not bucket:
            raise RuntimeError(
                "EXPERIMENT_METADATA_BUCKET env var is required for dispatch. "
                "Set it on the Lambda function (terraform: pmf-engine-control-plane)."
            )
        _manifest_loader = ManifestRoutingLoader(
            bucket=bucket,
            s3_client=boto3.client("s3"),
        )
    return _manifest_loader


def reset_manifest_loader_for_tests() -> None:
    global _manifest_loader
    _manifest_loader = None


def _resolve_routing(experiment_id: str, run_id: str = "") -> tuple[dict | None, list[str]]:
    """Look up routing from the S3 manifest loader.

    Returns (routing_or_none, list_of_known_experiment_ids_for_diagnostics).
    `routing is None` means the loader successfully read the index but the
    experiment_id is not registered — caller signals "unknown experiment".

    Loader failures (transient S3 / malformed manifest) raise
    ManifestLoaderTransientError or ManifestLoaderMalformedError. Both emit
    a `manifest_loader_fallback` CloudWatch metric with `error_type` and
    `Environment` dimensions so operators can alarm separately:
        transient → SQS will retry — usually self-heals
        malformed → publish-pipeline bug — page someone

    The handler converts both into SQS-retry signals (transient) or
    error-callback signals (malformed) — there is no in-process fallback.
    """
    loader = get_manifest_loader()
    try:
        routing = loader.routing_for(experiment_id)
        known = sorted(loader.known_experiments()) if routing is None else []
        return routing, known
    except ManifestLoaderError as e:
        error_type = "malformed" if isinstance(e, ManifestLoaderMalformedError) else "transient"
        logger.error(
            "manifest_loader_failure experiment_id=%s run_id=%s error_type=%s error=%s",
            experiment_id,
            run_id,
            error_type,
            e,
            exc_info=True,
        )
        _emit_metric(
            "manifest_loader_fallback",
            [
                {"Name": "Environment", "Value": os.environ.get("ENVIRONMENT", "unknown")},
                {"Name": "experiment_id", "Value": experiment_id},
                {"Name": "error_type", "Value": error_type},
            ],
        )
        raise


def get_ecs_client():
    global _ecs_client
    if _ecs_client is None:
        _ecs_client = boto3.client("ecs")
    return _ecs_client


JOB_TABLE_NAME = os.environ.get("JOB_TABLE_NAME", "")

_job_store = None


def get_job_store():
    global _job_store
    if _job_store is None:
        try:
            from .job_store import JobStore  # local import keeps cold-start lean
        except ImportError:
            from job_store import JobStore  # type: ignore[no-redef]
        _job_store = JobStore(JOB_TABLE_NAME)
    return _job_store


def reset_job_store_for_tests() -> None:
    global _job_store
    _job_store = None


def get_sqs_client():
    global _sqs_client
    if _sqs_client is None:
        _sqs_client = boto3.client("sqs")
    return _sqs_client


def get_cw_client():
    global _cw_client
    if _cw_client is None:
        _cw_client = boto3.client("cloudwatch")
    return _cw_client


def _emit_metric(metric_name: str, dimensions: list[dict]):
    try:
        get_cw_client().put_metric_data(
            Namespace="PMFEngine",
            MetricData=[
                {
                    "MetricName": metric_name,
                    "Value": 1,
                    "Unit": "Count",
                    "Dimensions": dimensions,
                }
            ],
        )
    except Exception as e:
        logger.warning(
            "MetricEmissionFailed metric=%s exc_type=%s: %s",
            metric_name,
            type(e).__name__,
            e,
            exc_info=True,
        )


def emit_dispatch_metric(metric_name: str, experiment_id: str):
    _emit_metric(
        metric_name,
        [
            {"Name": "Environment", "Value": os.environ.get("ENVIRONMENT", "unknown")},
            {"Name": "ExperimentId", "Value": experiment_id},
        ],
    )


def send_error_callback(
    message: dict,
    error: str,
    callback_queue_url: str,
    dedup_id: str | None = None,
) -> bool:
    """Send a `failed` callback to gp-api's results queue.

    Returns True if the SQS send succeeded, False otherwise (missing queue
    URL, SQS outage, or IAM regression). Callers use the return value to
    decide whether to add to `batch_item_failures`: if the callback did NOT
    reach gp-api, the dispatch message itself must be retried so we can try
    the callback again — otherwise the run row is stuck PENDING forever.

    Wire format MUST match what the broker's CallbackSender emits so gp-api's
    AgentExperimentResultSchema (zod) parses it.

    A judge run id short-circuits to False. gp-api has no `experiment_run` row
    for such a run, so every one of these callbacks would produce exactly one
    `Experiment run not found` error there — the error-rate and alerting storm
    the whole eval path exists to avoid, once per arm per sweep. Putting the
    check here rather than at the ten call sites is deliberate: it is a
    property of the destination, not of any one failure, and one of those call
    sites runs before `parse_dispatch_message` has even looked at the message.
    False rather than True, because every caller reads this as "the callback
    did not land, keep the SQS message" and the DLQ is exactly where a failed
    judge dispatch belongs. (`scheduler_handler._send_callback` makes the
    opposite choice in the same situation, because ITS return value advances
    job state and there is no row to orphan by advancing it.)
    """
    run_id_value = message.get("run_id")
    if isinstance(run_id_value, str) and run_id_value.startswith(JUDGE_RUN_ID_PREFIX):
        logger.info(
            "results_callback_suppressed reason=eval_run run_id=%s error=%s",
            run_id_value,
            error,
        )
        return False
    if not callback_queue_url:
        logger.error(
            "send_error_callback: no callback_queue_url configured; "
            "cannot notify gp-api of dispatch failure for run %s",
            message.get("run_id", "unknown"),
        )
        return False
    try:
        run_id = message.get("run_id", "unknown")
        body = json.dumps(
            {
                "type": "agentExperimentResult",
                "data": {
                    "experimentId": message.get("experiment_type", "unknown"),
                    "runId": run_id,
                    "organizationSlug": message.get("organization_slug", "unknown"),
                    "status": "failed",
                    "error": error,
                    "detail": error,
                    "reasonCode": "DispatchError",
                },
            }
        )
        get_sqs_client().send_message(
            QueueUrl=callback_queue_url,
            MessageBody=body,
            MessageGroupId="agentExperiments",
            MessageDeduplicationId=dedup_id or f"{run_id}-failed",
        )
        logger.info(f"Sent error callback for run {run_id}: {error}")
        return True
    except Exception as e:
        logger.exception(f"Failed to send error callback: {e}")
        return False


ECS_CLUSTER_ARN = os.environ.get("ECS_CLUSTER_ARN", "")
ECS_TASK_DEFINITION = os.environ.get("ECS_TASK_DEFINITION", "")
ECS_SUBNET_IDS = [s for s in os.environ.get("ECS_SUBNET_IDS", "").split(",") if s]
ECS_SECURITY_GROUP_ID = os.environ.get("ECS_SECURITY_GROUP_ID", "")
RESULTS_QUEUE_URL = os.environ.get("RESULTS_QUEUE_URL", "")
BROKER_URL = os.environ.get("BROKER_URL", "")
SERVICE_TOKENS_SECRET_ARN = os.environ.get("SERVICE_TOKENS_SECRET_ARN", "")
CONTAINER_NAME = os.environ.get("CONTAINER_NAME", "pmf-engine")


def _missing_critical_config() -> list[str]:
    missing = []
    if not ECS_CLUSTER_ARN:
        missing.append("ECS_CLUSTER_ARN")
    if not ECS_TASK_DEFINITION:
        missing.append("ECS_TASK_DEFINITION")
    if not ECS_SUBNET_IDS:
        missing.append("ECS_SUBNET_IDS")
    if not ECS_SECURITY_GROUP_ID:
        missing.append("ECS_SECURITY_GROUP_ID")
    if not RESULTS_QUEUE_URL:
        missing.append("RESULTS_QUEUE_URL")
    if not BROKER_URL:
        missing.append("BROKER_URL")
    if not SERVICE_TOKENS_SECRET_ARN:
        missing.append("SERVICE_TOKENS_SECRET_ARN")
    if not os.environ.get("EXPERIMENT_METADATA_BUCKET", "").strip():
        missing.append("EXPERIMENT_METADATA_BUCKET")
    if not JOB_TABLE_NAME:
        missing.append("JOB_TABLE_NAME")
    # ENVIRONMENT drives the expected `_input_files` bucket name. Without it,
    # _validate_input_files raises ValueError on any dispatch carrying user
    # uploads — surface the misconfig via the standard
    # "dispatch-misconfig" error-callback path instead of letting the message
    # dead-letter on an uncaught parse error.
    if not os.environ.get("ENVIRONMENT", "").strip():
        missing.append("ENVIRONMENT")
    return missing


# Hard upper bound on a dispatch's serialized params. Params no longer ride the
# ECS RunTask containerOverrides budget (anything over INLINE_PARAMS_BUDGET is
# pulled from the broker ticket instead), so the binding limit is now the SQS
# message that carries the dispatch gp-api -> this Lambda: SQS caps a message at
# 262144 bytes (params + the small run_id/slugs/type envelope). This cap is
# measured on Python's spaced json.dumps, which is always >= gp-api's compact
# JSON.stringify, so a payload that passes here is guaranteed to fit the compact
# SQS body (+ ~300-byte envelope) under 262144. 260000 leaves that headroom;
# going higher needs an SQS extended client / S3 offload on the gp-api side.
MAX_PARAMS_JSON_BYTES = 260000

# At or under this serialized size, params ride the PARAMS_JSON env var inline
# (byte-identical to the pre-broker dispatch). AWS ECS RunTask caps the total
# `containerOverrides[]` env payload (~8 KB), shared with INPUT_FILES_JSON and
# ~15 fixed env vars, so the inline budget stays at the old params cap; larger
# params are delivered out-of-band via the broker instead (PARAMS_VIA_BROKER).
INLINE_PARAMS_BUDGET = 6000

# Cap on the serialized INPUT_FILES_JSON env var the dispatch sets on the
# Fargate task. AWS ECS RunTask limits the total `containerOverrides[]`
# environment payload, and our other env vars (PARAMS_JSON, ANTHROPIC_BASE_URL,
# etc.) already consume budget. With realistic agenda-upload entries
# (~150–300 bytes each), 4000 bytes covers 10+ entries; with worst-case
# max-length entries (~1.3 KB each) it covers ~3. Reject larger payloads at
# dispatch with a clean error callback rather than letting RunTask fail
# silently on oversize overrides.
MAX_INPUT_FILES_JSON_BYTES = 4000

_PRIOR_ARTIFACT_VALUE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,64}/artifact\.json$")


_PRIOR_ARTIFACT_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _validate_prior_artifact_versions(versions) -> None:
    if versions is None:
        return
    if not isinstance(versions, dict):
        raise ValueError(f"prior_artifact_versions must be an object, got {type(versions).__name__}")
    if len(versions) > 10:
        raise ValueError(f"prior_artifact_versions too large: {len(versions)} entries")
    for key, value in versions.items():
        if not isinstance(key, str) or not _PRIOR_ARTIFACT_KEY_RE.fullmatch(key):
            raise ValueError(f"prior_artifact_versions key must match [A-Za-z0-9_-]{{1,64}}: got {key!r}")
        if not isinstance(value, str) or not _PRIOR_ARTIFACT_VALUE_RE.fullmatch(value):
            raise ValueError(
                f"prior_artifact_versions[{key!r}] must match "
                f"'<experiment_id>/<run_id>/artifact.json' pattern "
                f"(segments [A-Za-z0-9_-]{{1,64}}): got {value!r}"
            )


# Mirrored in broker InputFileRef.dest and runner input_files._DEST_RE —
# three-gate defense since `dest` becomes a basename under /workspace/input/.
# `{0,254}` after the leading char bounds total length at 255 to match the
# broker's Pydantic Field max_length.
_INPUT_FILE_DEST_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}$")
_INPUT_FILE_REQUIRED_KEYS = {"bucket", "key", "dest"}
# Mirrors prior_artifact_versions cap.
_MAX_INPUT_FILES = 10


def _expected_inputs_bucket() -> str:
    """The single bucket dispatch is allowed to authorize for /inputs/read in
    this environment. Derived from the ENVIRONMENT env var (`dev`/`qa`/`prod`),
    matching what gp-ai Terraform creates and what the broker IAM
    grants GetObject on. Any other bucket name in `_input_files[i].bucket` is
    rejected — defense in depth atop the broker's ScopeTicket allowlist.
    """
    env = os.environ.get("ENVIRONMENT", "").strip().lower()
    return f"gp-agent-run-inputs-{env}" if env else ""


def _validate_input_files(value) -> None:
    """Validate the shape of `_input_files` before it reaches mint / Fargate.

    Parallels `_validate_prior_artifact_versions`. Each entry must carry
    {bucket, key, dest} where `dest` is a safe basename (the runner writes
    `/workspace/input/<dest>`, so a slash or `..` here would escape the
    workspace despite broker + runner re-checks). `bucket` must equal the
    single expected inputs bucket for this environment — no caller is
    legitimately authorized to reference any other bucket.
    """
    if value is None:
        return
    if not isinstance(value, list):
        raise ValueError(f"_input_files must be an array, got {type(value).__name__}")
    if len(value) > _MAX_INPUT_FILES:
        raise ValueError(f"_input_files too large: {len(value)} entries (max {_MAX_INPUT_FILES})")
    expected_bucket = _expected_inputs_bucket()
    if not expected_bucket:
        raise ValueError(
            "_input_files cannot be validated: ENVIRONMENT env var missing on dispatch lambda; "
            "set ENVIRONMENT to one of dev/prod (see modules/pmf-engine-control-plane/main.tf)"
        )
    for i, entry in enumerate(value):
        if not isinstance(entry, dict):
            raise ValueError(f"_input_files[{i}] must be an object, got {type(entry).__name__}")
        missing = _INPUT_FILE_REQUIRED_KEYS - set(entry.keys())
        if missing:
            raise ValueError(f"_input_files[{i}] missing required keys: {sorted(missing)}")
        bucket, key, dest = entry["bucket"], entry["key"], entry["dest"]
        if not isinstance(bucket, str) or bucket != expected_bucket:
            raise ValueError(f"_input_files[{i}].bucket must be {expected_bucket!r}: got {bucket!r}")
        if not isinstance(key, str) or not (0 < len(key) <= 1024):
            raise ValueError(f"_input_files[{i}].key must be a 1-1024 char string: got {key!r}")
        if not isinstance(dest, str) or not _INPUT_FILE_DEST_RE.fullmatch(dest):
            raise ValueError(
                f"_input_files[{i}].dest must be a simple filename matching [A-Za-z0-9_][A-Za-z0-9._-]*: got {dest!r}"
            )


# ---------------------------------------------------------------------------
# Judge override (Universal Judge v1, Runner 2)
# ---------------------------------------------------------------------------
# A judge sweep runs a CANDIDATE branch's manifest + instruction without
# publishing them, because `publish_experiments.py` has no per-experiment filter
# and rewrites index.json last as one global atomic switch — publishing branch
# bytes would unpublish every other experiment. The candidate's bytes are staged
# under a content-addressed `_judge/<agentId>/<configDigest>/` folder and the
# dispatch message names them in `_judge_override`.
#
# THE SECURITY INVARIANT: a judge run can change what the agent is TOLD to do,
# never what it is ALLOWED to touch. The real experiment is still resolved
# through the normal index lookup, and the scope ticket, ECS routing and
# input_schema all come from THAT manifest. `derive_scope` reads allowed_tables
# and max_rows off the manifest and defaults to a hard deny, so an override that
# could declare its own `scope` would let any branch grant itself any Databricks
# table. Only the behavior fields below are honored; a `scope` key, or anything
# else unrecognised, is rejected loudly rather than dropped.
#
# The S3 version pin is part of that enforcement, not only race protection:
# dispatch vets the override object's contents and the broker reads the same
# object minutes later. Unpinned, anyone who can write the key could swap the
# bytes between those two reads and the allowlist would have vetted something
# the agent never runs.
_JUDGE_OVERRIDE_KEY_FIELDS = frozenset({"manifest_key", "instruction_key"})

# Exactly the fields the Fargate runner reads off the manifest the broker serves
# it (`runner/config.py`), so an override can change how the agent behaves and
# what artifact shape it must produce — and nothing else. `model`, `max_turns`
# and `output_schema` are REQUIRED because `runner/manifest_loader` hard-requires
# them; checking here fails a mis-staged sweep at dispatch with a clear message
# instead of at Fargate start. Note that only `model` and `timeout_seconds` are
# consumed by this Lambda; `max_turns` and `output_schema` reach the agent via
# the broker's manifest response, so they are validated here and deliberately
# NOT forwarded as env vars.
_JUDGE_OVERRIDE_BEHAVIOR_FIELDS = frozenset({"model", "max_turns", "timeout_seconds", "output_schema", "runtime"})
_JUDGE_OVERRIDE_REQUIRED_BEHAVIOR_FIELDS = ("model", "max_turns", "output_schema")

# `runtime` has to be allowed through, not refused, because the broker serves
# the override manifest IN PLACE OF the published one and 11 of the 16 published
# experiments declare it — all of them setting `max_thinking_tokens: 0`, several
# also setting `max_parallel_subagents` to 3..6. Dropped, every candidate arm
# would silently switch extended thinking ON and fan-out OFF, so the sweep would
# score that config delta instead of the branch: exactly the failure mode the
# write-action refusal below exists to prevent. It is also safe to allow — the
# runner reads it off the manifest the broker serves (never an env var), and it
# governs how hard the agent thinks, not what it may touch.
#
# The closed key set and the 0..20 fan-out bound come from the published
# meta-schema (runbooks `experiments/_schema/manifest.schema.json`:
# `additionalProperties: false`, `max_parallel_subagents` 0..20). The
# meta-schema sets no ceiling on `max_thinking_tokens`; the one here is ours,
# above any real model budget, so that a nonsense value fails at dispatch
# rather than on the agent's first turn. That is the only bound stricter than
# a publishable manifest's.
_JUDGE_OVERRIDE_RUNTIME_FIELDS = frozenset({"max_parallel_subagents", "max_thinking_tokens"})
_JUDGE_OVERRIDE_MAX_PARALLEL_SUBAGENTS_BOUNDS = (0, 20)
_JUDGE_OVERRIDE_MAX_THINKING_TOKENS_BOUNDS = (0, 200_000)

# Bounds mirror the published manifest meta-schema (runbooks
# `experiments/_schema/manifest.schema.json`) so an override cannot ask for
# anything a publishable manifest could not. `model` is pattern-checked rather
# than enum-checked: it becomes an ECS containerOverrides env value, so what
# matters here is that it is one short token with no newlines or separators, and
# duplicating the enum in a second repo would only rot.
_JUDGE_OVERRIDE_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_JUDGE_OVERRIDE_MAX_TURNS_BOUNDS = (1, 200)
_JUDGE_OVERRIDE_TIMEOUT_BOUNDS = (60, 14400)

# The only ENVIRONMENT a judge override is honored in. Terraform sets this to
# exactly "dev" or "prod" (infrastructure/environments/*/pmf-engine-control-plane).
_JUDGE_OVERRIDE_ENVIRONMENT = "dev"


# Error messages from this module reach gp-api through the results queue and
# get persisted; the values they quote come off a dispatch message or an S3
# object, neither of which is length-bounded upstream. 200 chars is enough to
# identify what was wrong without letting a caller choose how much text we
# store and log.
_MAX_ERROR_VALUE_CHARS = 200


def _truncated(value: object) -> str:
    # repr first, then slice: a dict or list then reads as itself rather than
    # as a quoted string of itself.
    return repr(value)[:_MAX_ERROR_VALUE_CHARS]


# Mirrors `runner/config._is_draft7_object_schema`. Duplicated rather than
# imported because the runner ships in the Fargate image and this module ships
# in the Lambda zip (`pmf_engine/scripts/build_lambda_package.sh` copies only
# the control_plane modules) — there is no import path between them. The point
# of checking here is fail-fast: without it `{"type": "object"}` with no
# properties, `{"oneOf": []}`, and the legacy no-op `{"name": "string"}` shape
# all pass dispatch and then either crash at Fargate start or, worse, let the
# candidate arm run with a schema Draft7Validator accepts everything against —
# so the judge would score an unconstrained artifact as valid. Keep the two in
# sync; the runner's copy carries the full rationale.
_COMBINATOR_KEYS = ("oneOf", "anyOf", "allOf")
_MAX_COMBINATOR_DEPTH = 4


def _is_draft7_object_schema(schema: object, _depth: int = 0) -> bool:
    if _depth > _MAX_COMBINATOR_DEPTH:
        return False
    if not isinstance(schema, dict):
        return False
    if schema.get("type") == "object" and isinstance(schema.get("properties"), dict):
        return True
    for combinator in _COMBINATOR_KEYS:
        branches = schema.get(combinator)
        if isinstance(branches, list) and branches:
            if all(_is_draft7_object_schema(b, _depth + 1) for b in branches):
                return True
    return False


def _validate_judge_override(value, experiment_id: str) -> dict | None:
    """Validate the `_judge_override` dispatch field's shape. No S3 access.

    Parallels `_validate_input_files`: shape is settled at parse time, before
    anything reaches S3, mint or Fargate. Every path segment is pinned via
    `JUDGE_OVERRIDE_KEY_RE` rather than the `_judge/` prefix merely being
    checked, and the `agentId` segment must equal the experiment being
    dispatched so an override can only ever belong to its own agent.
    """
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"_judge_override must be an object, got {type(value).__name__}")
    keys = set(value.keys())
    missing = _JUDGE_OVERRIDE_KEY_FIELDS - keys
    if missing:
        raise ValueError(f"_judge_override missing required keys: {sorted(missing)}")
    unknown = keys - _JUDGE_OVERRIDE_KEY_FIELDS
    if unknown:
        raise ValueError(
            f"_judge_override has unknown key(s) {_truncated(sorted(unknown))}; "
            f"allowed: {sorted(_JUDGE_OVERRIDE_KEY_FIELDS)}"
        )

    folders = {}
    for field, leaf in (("manifest_key", "manifest.json"), ("instruction_key", "instruction.md")):
        key = value[field]
        if not isinstance(key, str):
            raise ValueError(f"_judge_override.{field} must be a string, got {type(key).__name__}")
        match = JUDGE_OVERRIDE_KEY_RE.fullmatch(key)
        if match is None or match.group("leaf") != leaf:
            raise ValueError(
                f"_judge_override.{field} must be exactly "
                f"'_judge/<agentId>/<configDigest>/{leaf}' with each segment matching "
                f"[A-Za-z0-9_-]{{1,64}}: got {_truncated(key)}"
            )
        if match.group("agent_id") != experiment_id:
            raise ValueError(
                f"_judge_override.{field} agentId segment {match.group('agent_id')!r} "
                f"does not match experiment_type {experiment_id!r}"
            )
        folders[field] = match.group("digest")
    if folders["manifest_key"] != folders["instruction_key"]:
        raise ValueError(
            "_judge_override.manifest_key and instruction_key must name the same "
            "_judge/<agentId>/<configDigest>/ folder; got digests "
            f"{folders['manifest_key']!r} and {folders['instruction_key']!r}"
        )
    return {"manifest_key": value["manifest_key"], "instruction_key": value["instruction_key"]}


def _bounded_int(field: str, value: object, bounds: tuple[int, int]) -> int:
    low, high = bounds
    # Truncated before interpolation: this message rides the error callback to
    # gp-api's results queue and lands in a DB error column, and the value came
    # off an S3 object nothing upstream bounds. Mirrors
    # `_validate_input_files`, which caps its key at 1024 chars for the same
    # reason.
    complaint = f"{field} must be an integer in {low}..{high}; got {_truncated(value)}"
    # `isinstance(True, int)` is True in Python, so bools must be excluded
    # explicitly or `max_turns: true` would sail through as 1.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(complaint)
    if not (low <= value <= high):
        raise ValueError(complaint)
    return value


def _judge_override_behavior(manifest: dict, manifest_key: str) -> dict:
    """Project an override manifest down to the allowlisted behavior fields.

    `scope` is named ahead of the generic unknown-key error so the failure
    reads as the invariant it violated rather than as a typo.
    """
    if "scope" in manifest:
        raise ValueError(
            f"judge override manifest {manifest_key} declares 'scope'. A judge run may change what the "
            "agent is told to do, never what it is allowed to touch — scope, routing and input_schema "
            "come from the published manifest only."
        )
    unknown = sorted(set(manifest.keys()) - _JUDGE_OVERRIDE_BEHAVIOR_FIELDS)
    if unknown:
        raise ValueError(
            f"judge override manifest {manifest_key} carries non-behavior field(s) {_truncated(unknown)}; "
            f"a judge override may only set {sorted(_JUDGE_OVERRIDE_BEHAVIOR_FIELDS)}"
        )
    absent = [f for f in _JUDGE_OVERRIDE_REQUIRED_BEHAVIOR_FIELDS if f not in manifest]
    if absent:
        raise ValueError(
            f"judge override manifest {manifest_key} is missing field(s) {absent}, which the Fargate "
            "runner requires of any manifest the broker serves it"
        )

    model = manifest["model"]
    if not isinstance(model, str) or not _JUDGE_OVERRIDE_MODEL_RE.fullmatch(model):
        raise ValueError(
            f"judge override manifest {manifest_key}: model must match "
            f"{_JUDGE_OVERRIDE_MODEL_RE.pattern}; got {_truncated(model)}"
        )
    output_schema = manifest["output_schema"]
    if not _is_draft7_object_schema(output_schema):
        raise ValueError(
            f"judge override manifest {manifest_key}: output_schema must be a JSON Schema Draft-07 object — "
            f"either type='object' with a properties dict, or a non-empty oneOf/anyOf/allOf whose every "
            f"branch is one; got {_truncated(output_schema)}"
        )

    behavior = {
        "model": model,
        "max_turns": _bounded_int(
            f"judge override manifest {manifest_key}: max_turns",
            manifest["max_turns"],
            _JUDGE_OVERRIDE_MAX_TURNS_BOUNDS,
        ),
        "output_schema": output_schema,
    }
    if "timeout_seconds" in manifest:
        behavior["timeout_seconds"] = _bounded_int(
            f"judge override manifest {manifest_key}: timeout_seconds",
            manifest["timeout_seconds"],
            _JUDGE_OVERRIDE_TIMEOUT_BOUNDS,
        )
    if "runtime" in manifest:
        behavior["runtime"] = _judge_override_runtime(manifest["runtime"], manifest_key)
    return behavior


def _judge_override_runtime(runtime: object, manifest_key: str) -> dict:
    """Vet an override manifest's `runtime` block.

    Absence is meaningful here in a way it is not for the other fields: no
    `runtime` means the harness defaults, which turn extended thinking ON. A
    candidate staged from an experiment whose published manifest sets
    `max_thinking_tokens: 0` and omits it by accident gets a different agent,
    not a different branch — but that is a staging bug this cannot see, so the
    block is validated and passed through rather than defaulted.
    """
    if not isinstance(runtime, dict):
        raise ValueError(
            f"judge override manifest {manifest_key}: runtime must be an object; got {_truncated(runtime)}"
        )
    unknown = sorted(set(runtime.keys()) - _JUDGE_OVERRIDE_RUNTIME_FIELDS)
    if unknown:
        raise ValueError(
            f"judge override manifest {manifest_key}: runtime carries unknown field(s) "
            f"{_truncated(unknown)}; allowed: {sorted(_JUDGE_OVERRIDE_RUNTIME_FIELDS)}"
        )
    vetted: dict = {}
    for field, bounds in (
        ("max_parallel_subagents", _JUDGE_OVERRIDE_MAX_PARALLEL_SUBAGENTS_BOUNDS),
        ("max_thinking_tokens", _JUDGE_OVERRIDE_MAX_THINKING_TOKENS_BOUNDS),
    ):
        if field in runtime:
            vetted[field] = _bounded_int(
                f"judge override manifest {manifest_key}: runtime.{field}",
                runtime[field],
                bounds,
            )
    return vetted


def _resolve_judge_override(override: dict, experiment: dict, experiment_id: str) -> dict:
    """Fetch + vet an override.

    Returns `{"behavior": <the allowlisted fields>, "ticket_allowlist": <the
    key pair plus both S3 VersionIds>}`. The allowlist is what rides the minted
    ScopeTicket, next to the existing `input_files` allowlist, and is the only
    thing that widens what the broker will serve this run.

    Two refusals before any S3 read, and one after it (an unpinnable object,
    below):

    - Dev only, as an allowlist rather than a deny-prod check so an unexpected
      ENVIRONMENT value refuses instead of slipping through. The judge stages
      candidate bytes in the dev metadata bucket and its runs bypass gp-api
      entirely, so an override reaching any other environment means something
      upstream is wrong — and a prod judge run would write a test artifact
      under a real organization's experiment prefix.
    - Never for a write-action experiment. The broker serves the override
      manifest in place of the published one, and the behavior allowlist cannot
      carry `system_prompt` / `permission_mode`, so the candidate arm would
      silently lose them and the comparison would measure that loss instead of
      the branch.
    """
    # `parse_dispatch_message` already refused this dispatch outside dev, via
    # `_validate_judge_dispatch`. Repeated here because this function is what
    # reads unpublished bytes out of S3 and hands them to a run, and it is
    # called from a different place than the parse gate.
    env = os.environ.get("ENVIRONMENT", "").strip().lower()
    if env != _JUDGE_OVERRIDE_ENVIRONMENT:
        raise ValueError(
            f"_judge_override is only accepted when ENVIRONMENT is "
            f"{_JUDGE_OVERRIDE_ENVIRONMENT!r}; this lambda has {_truncated(env)}"
        )
    if _is_write_action(experiment):
        raise ValueError(
            f"_judge_override is not supported for write-action experiment {experiment_id!r}: the behavior "
            "allowlist cannot carry system_prompt / permission_mode, so the override would drop them"
        )
    # Same reasoning, for the one write-action field that is NOT a write-action
    # discriminator: `allowed_external_tools` widens which non-gp-api tools the
    # agent may reach, so it can never ride an override — which means an
    # experiment that declares it would silently lose it, and the sweep would
    # measure that loss. No published experiment sets it today, so this refuses
    # nothing we currently run.
    if experiment.get("allowed_external_tools") is not None:
        raise ValueError(
            f"_judge_override is not supported for {experiment_id!r}: its published manifest declares "
            "allowed_external_tools, which widens what the agent may touch and so cannot ride an override — "
            "the candidate arm would silently lose it"
        )
    manifest, manifest_version_id, instruction_version_id = get_manifest_loader().fetch_judge_override(
        manifest_key=override["manifest_key"],
        instruction_key=override["instruction_key"],
    )
    # S3 returns no VersionId on an unversioned — or version-SUSPENDED —
    # bucket, and the pin is load-bearing rather than a nicety: dispatch vets
    # the override manifest's contents and the broker reads the same object
    # minutes later, so unpinned, anyone who can write the key can swap the
    # bytes in between and the behavior allowlist will have vetted something
    # the agent never runs. Degrading to "latest" is therefore a refusal, not
    # a fallback. The dev metadata bucket is versioned today, so this is a
    # guard against `aws_s3_bucket_versioning` being set to `Suspended` (which
    # keeps existing versions but stops minting new VersionIds) rather than a
    # condition we expect to hit.
    unpinned = [
        field
        for field, pin in (
            ("manifest_key", manifest_version_id),
            ("instruction_key", instruction_version_id),
        )
        if not pin
    ]
    if unpinned:
        raise ValueError(
            f"judge override {unpinned} returned no S3 VersionId, so the bytes dispatch just vetted cannot be "
            "pinned for the broker's read. Enable versioning on the experiment-metadata bucket "
            "(aws_s3_bucket_versioning status must be Enabled, not Suspended) before running a sweep."
        )
    return {
        "behavior": _judge_override_behavior(manifest, override["manifest_key"]),
        "ticket_allowlist": {
            "manifest_key": override["manifest_key"],
            "instruction_key": override["instruction_key"],
            "manifest_version_id": manifest_version_id,
            "instruction_version_id": instruction_version_id,
        },
    }


# Dispatch-envelope metadata that ships inside params. The `_` prefix marks
# a key as runner-orchestration, not agent input: stripped from params before
# input_schema validation and before PARAMS_JSON is built, then re-attached
# to the top-level message for downstream code. Unknown `_`-prefixed keys
# raise so typos don't silently vanish.
_RESERVED_ENVELOPE_KEYS = {"_input_files"}


def parse_dispatch_message(body: str) -> dict:
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, TypeError) as e:
        raise ValueError(f"Invalid message body: {e}") from e

    for field in ("experiment_type", "organization_slug", "run_id"):
        if not data.get(field):
            raise ValueError(f"Missing required field: {field}")

    if not isinstance(data["experiment_type"], str) or not _EXPERIMENT_ID_RE.match(data["experiment_type"]):
        raise ValueError(f"experiment_type must match {_EXPERIMENT_ID_RE.pattern}")
    if not isinstance(data["run_id"], str) or not _IDENTIFIER_RE.match(data["run_id"]):
        raise ValueError("run_id must match [a-zA-Z0-9_-]{1,64}")
    if not isinstance(data["organization_slug"], str) or not _IDENTIFIER_RE.match(data["organization_slug"]):
        raise ValueError("organization_slug must match [a-zA-Z0-9_-]{1,64}")
    # clerk_user_id is optional. When omitted, broker mint skips the Clerk
    # actor-token round trip and the ticket has clerk_session_id=None.
    # Experiments that hit /agent-mcp will be 4xx'd by that route's guard.
    if "clerk_user_id" in data and data["clerk_user_id"] is not None and not isinstance(data["clerk_user_id"], str):
        raise ValueError("clerk_user_id must be a string when provided")

    priority = data.get("priority", "DEFAULT")
    if priority not in ("HIGH", "DEFAULT"):
        raise ValueError("priority must be 'HIGH' or 'DEFAULT'")
    data["priority"] = priority

    if data.get("params") is None:
        data["params"] = {}

    # Envelope-strip pass. Must happen BEFORE input_schema validation
    # (otherwise the manifest would need to list `_input_files` in its
    # schema) and BEFORE building PARAMS_JSON (otherwise the agent's env
    # would carry runner-orchestration data). Non-dict params is handled
    # later in the handler loop with an InvalidParamsType error callback,
    # so we just skip stripping when params isn't a dict.
    if isinstance(data["params"], dict):
        unknown_envelope_keys = [
            k for k in data["params"] if isinstance(k, str) and k.startswith("_") and k not in _RESERVED_ENVELOPE_KEYS
        ]
        if unknown_envelope_keys:
            raise ValueError(
                f"params contains unknown _-prefixed key(s) "
                f"{sorted(unknown_envelope_keys)}; reserved for dispatch envelope only"
            )
        input_files = data["params"].pop("_input_files", None)
        if input_files is not None:
            _validate_input_files(input_files)
            # Re-attach on the top-level dispatch dict so downstream code
            # (mint call, INPUT_FILES_JSON env builder) reads it like any
            # other dispatch field — symmetric with prior_artifact_versions.
            data["_input_files"] = input_files

    _validate_prior_artifact_versions(data.get("prior_artifact_versions"))
    # Top-level, like prior_artifact_versions and unlike `_input_files`: the
    # judge dispatches straight to SQS rather than through gp-api's params, and
    # `_judge_override` is never agent input. Absent on every product dispatch,
    # which is what keeps the no-override path unchanged.
    judge_override = _validate_judge_override(data.get("_judge_override"), data["experiment_type"])
    # The judge gate is on the RUN, not on the override arm. A sweep's base arm
    # carries a judge run id and no `_judge_override` at all, and it gets every
    # consequence the prefix implies — suppressed callbacks, no reaper, no
    # `latest.json` write, no gp-api row — so it has to pass the same checks.
    # Gating only the override arm would leave the base arm ungated in prod,
    # spending real money on a run nothing can observe or reconcile.
    if data["run_id"].startswith(JUDGE_RUN_ID_PREFIX) or judge_override is not None:
        _validate_judge_dispatch(data["run_id"])
        if judge_override is not None:
            data["_judge_override"] = judge_override
    return data


def _validate_judge_dispatch(run_id: str) -> None:
    """Shape and environment checks every judge dispatch must pass.

    The run-id shape is `fullmatch` on an explicit alphabet rather than
    `startswith`, for two reasons. ECS caps `startedBy` at
    JUDGE_RUN_ID_MAX_LENGTH characters, dispatch sets it to the run id
    verbatim, and `task_reaper` reads it back to identify the run — past the
    cap a sweep mints a ticket and claims the job to LAUNCHING before RunTask
    rejects it on validation, so every job sticks. And the envelope's own
    run-id check is `re.match` against a `$`-anchored pattern, which in Python
    also accepts a trailing newline; a judge run id decides whether gp-api
    hears about this run at all, so it gets the stricter check.

    Dev-only as an allowlist rather than a deny-prod check, so an unexpected
    ENVIRONMENT refuses instead of slipping through. A judge run bypasses
    gp-api entirely: in prod it would spend real money on a run with no
    `experiment_run` row, write an artifact under a real organization's
    experiment prefix, and suppress every signal that would surface it.
    """
    if JUDGE_RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError(
            f"a judge run_id must match {JUDGE_RUN_ID_RE.pattern} (ECS caps startedBy at "
            f"{JUDGE_RUN_ID_MAX_LENGTH} characters and dispatch passes the run id through verbatim); "
            f"got {_truncated(run_id)}"
        )
    env = os.environ.get("ENVIRONMENT", "").strip().lower()
    if env != _JUDGE_OVERRIDE_ENVIRONMENT:
        raise ValueError(
            f"a judge dispatch is only accepted when ENVIRONMENT is "
            f"{_JUDGE_OVERRIDE_ENVIRONMENT!r}; this lambda has {_truncated(env)}"
        )


def build_container_overrides(
    experiment: dict,
    message: dict,
    broker_token: str,
    broker_url: str,
    container_name: str,
    params_json: str | None = None,
) -> dict:
    if params_json is None:
        params_json = json.dumps(message["params"])
    # Small params ride PARAMS_JSON inline (byte-identical to the pre-broker
    # dispatch). Larger params would blow the ECS RunTask containerOverrides
    # budget, so route them off the env var: set PARAMS_VIA_BROKER and let the
    # runner fetch them from the broker's /params/read, which serves them from
    # this run's scope ticket (minted with the full params at launch).
    if len(params_json.encode("utf-8")) <= INLINE_PARAMS_BUDGET:
        params_env = {"name": "PARAMS_JSON", "value": params_json}
    else:
        params_env = {"name": "PARAMS_VIA_BROKER", "value": "1"}
    env = [
        {"name": "EXPERIMENT_ID", "value": message["experiment_type"]},
        {"name": "RUN_ID", "value": message["run_id"]},
        {"name": "ORGANIZATION_SLUG", "value": message["organization_slug"]},
        {"name": "AGENT_MODEL", "value": experiment["model"]},
        {"name": "BROKER_TOKEN", "value": broker_token},
        {"name": "BROKER_URL", "value": broker_url},
        {"name": "ANTHROPIC_BASE_URL", "value": f"{broker_url}/anthropic"},
        {"name": "ANTHROPIC_API_KEY", "value": broker_token},
        params_env,
        {"name": "TIMEOUT_SECONDS", "value": str(experiment.get("timeout_seconds", 600))},
        # QA_JUDGES configures the runbooks qa-spine pluggable LLM judge registry
        # (format: name:provider:model,...). Routes through the same broker proxy
        # the runner already uses for the agent — no new Secrets Manager entries,
        # no new egress. Same-family Phase 1/2 (Sonnet + Opus with adversarial
        # system prompt) is the documented in-Fargate path; cross-family (e.g.
        # Gemini Phase 2) is deferred until/if a broker route for Google exists.
        {"name": "QA_JUDGES", "value": "claude:anthropic:claude-sonnet-4-6,opus:anthropic:claude-opus-4-7"},
    ]
    # Pin the runner to the exact S3 object versions Lambda fetched at routing
    # time. Without this, a publish during the dispatch→start window could
    # let the runner read different bytes than Lambda routed against.
    if experiment.get("manifest_version_id"):
        env.append({"name": "MANIFEST_VERSION_ID", "value": experiment["manifest_version_id"]})
    if experiment.get("instruction_version_id"):
        env.append({"name": "INSTRUCTION_VERSION_ID", "value": experiment["instruction_version_id"]})
    # Attachment VersionIds are sidecar pins captured by the manifest loader's
    # per-attachment HEADs. sort_keys keeps the env-var value byte-deterministic
    # across dispatches so downstream caches / idempotency tests don't churn
    # on dict iteration order. Skip when empty/absent — empty env vars are
    # noise and the runner already special-cases empty/unset.
    if experiment.get("attachment_version_ids"):
        env.append(
            {
                "name": "ATTACHMENT_VERSION_IDS",
                "value": json.dumps(experiment["attachment_version_ids"], sort_keys=True),
            }
        )
    # QA gate version pins (contract G). Mirrors ATTACHMENT_VERSION_IDS exactly:
    # {basename: VersionId}, sort_keys for byte-deterministic output. Skip when
    # empty/absent — on an unversioned bucket every pin is None so the map is
    # empty, the env var is omitted, and the runner fetches qa 'latest'. This
    # keeps the no-qa containerOverrides byte-identical to a pre-gate dispatch.
    if experiment.get("qa_version_ids"):
        env.append(
            {
                "name": "QA_VERSION_IDS",
                "value": json.dumps(experiment["qa_version_ids"], sort_keys=True),
            }
        )
    # When the dispatch carries enumerated input-file refs (e.g. user-uploaded
    # agenda PDFs), the runner pre-fetches each via the broker's /inputs/read
    # endpoint before invoking the agent. Refs travel as a JSON-encoded env var
    # — refs are small (a few hundred bytes each, capped at 10 entries).
    if message.get("_input_files"):
        env.append(
            {
                "name": "INPUT_FILES_JSON",
                "value": json.dumps(message["_input_files"]),
            }
        )
    # Write-action manifest fields (system_prompt, permission_mode,
    # allowed_external_tools — ENG-10128) are not forwarded as env vars on
    # purpose: the runner fetches the full manifest itself via
    # runner/manifest_loader.load_from_broker (pinned by MANIFEST_VERSION_ID
    # above) and reads them directly. Duplicating them here would create a
    # second source of truth and risk env-var size limits for system_prompt.
    return {"containerOverrides": [{"name": container_name, "environment": env}]}


def launch_run(
    *,
    experiment: dict,
    message: dict,
    scope: dict,
    params_json: str,
) -> dict:
    """Mint a broker token and launch the Fargate task. Returns
    {"status": "launched", "task_arn": ...} on success, or
    {"status": "failed", "error": <user-safe>} when the run could not be
    launched (broker rejection, ECS RunTask failure). Raises on transient
    errors the caller should retry (httpx during mint, ECS RunTask exception).
    """
    experiment_id = message["experiment_type"]
    prior_artifact_versions = message.get("prior_artifact_versions")
    # User-input prefetch (develop): the scheduler threads `_input_files` from
    # the QueuedJob into this message; mint's MintRequest field is `input_files`
    # (no leading underscore at the API boundary).
    input_files = message.get("_input_files")
    # Judge override: the allowlist of experiment-metadata keys this run's
    # ticket authorizes the broker to serve in place of `<experiment_id>/*`,
    # alongside the existing `input_files` allowlist. None on every product
    # dispatch, and the mint body omits the field entirely when it is None.
    experiment_override = experiment.get("judge_override")
    # A judge-dispatched run — override arm or base arm — has no gp-api
    # `experiment_run` row, so the ticket must tell the broker never to send it
    # a results callback. The run id prefix is the signal; it is also what the
    # task reaper keys on, and `parse_dispatch_message` refuses an override
    # that does not carry it. Product run ids are UUIDv7, so this is False on
    # every product dispatch and the mint body omits the field entirely.
    is_eval = message["run_id"].startswith(JUDGE_RUN_ID_PREFIX)
    try:
        broker = get_broker_client()
        mint_result = broker.mint_run_token(
            run_id=message["run_id"],
            organization_slug=message["organization_slug"],
            experiment_id=experiment_id,
            scope=scope,
            params=message["params"],
            clerk_user_id=message.get("clerk_user_id"),
            # The one documented exception to "the scope ticket comes from the
            # published manifest": on a judge run this reads the OVERRIDE's
            # timeout_seconds, because the ticket has to outlive the run the
            # agent actually gets and that run is timed by the override. It
            # grants nothing a published manifest could not, since the
            # override's timeout is bounded by the same 60..14400 the manifest
            # meta-schema imposes, and mint caps the resulting TTL at
            # MAX_TTL_SECONDS regardless. See control_plane/README.md.
            exp_ttl_seconds=experiment.get("timeout_seconds", 3600) + 300,
            prior_artifact_versions=prior_artifact_versions,
            input_files=input_files,
            experiment_override=experiment_override,
            is_eval=is_eval,
        )
    except BrokerError as e:
        logger.warning(f"Broker rejected {experiment_id} (run={message['run_id']}): {e.status_code} {e.detail}")
        emit_dispatch_metric("BrokerRejected", experiment_id)
        return {"status": "failed", "error": e.user_safe_message or "Broker rejected the request"}
    except httpx.HTTPError as e:
        logger.warning(f"Transient network error during mint for run {message.get('run_id')}: {e}")
        emit_dispatch_metric("MintTransient", experiment_id)
        raise
    except Exception as e:
        logger.exception(f"Unexpected error during mint for run {message.get('run_id')}: {e}")
        emit_dispatch_metric("MintUnexpected", experiment_id)
        return {"status": "failed", "error": f"Unexpected dispatch error: {type(e).__name__}"}

    overrides = build_container_overrides(
        experiment=experiment,
        message=message,
        broker_token=mint_result["broker_token"],
        broker_url=BROKER_URL,
        container_name=CONTAINER_NAME,
        params_json=params_json,
    )

    logger.info(
        f"Dispatching experiment '{experiment_id}' for organization "
        f"'{message['organization_slug']}' (run: {message['run_id']})"
    )

    minted_broker_token = mint_result["broker_token"]

    try:
        response = get_ecs_client().run_task(
            cluster=ECS_CLUSTER_ARN,
            taskDefinition=ECS_TASK_DEFINITION,
            launchType="FARGATE",
            tags=[{"key": "Project", "value": "pmf-engine"}],
            # Tag the task with the run_id (uuid7, 36 chars — within the 36-char
            # startedBy limit) so the stuck-LAUNCHING sweep can tell whether a
            # LAUNCHING job has a live task before it fails the row.
            startedBy=message["run_id"],
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": ECS_SUBNET_IDS,
                    "securityGroups": [ECS_SECURITY_GROUP_ID],
                    "assignPublicIp": "DISABLED",
                }
            },
            overrides=overrides,
        )

        failures = response.get("failures", [])
        tasks = response.get("tasks", [])

        if failures or not tasks:
            failure_reasons = [f.get("reason", "unknown") for f in failures]
            logger.error(f"ECS RunTask failed (experiment={experiment_id}, run={message['run_id']}): {failure_reasons}")
            _cleanup_minted_token(broker, minted_broker_token, message["run_id"])
            safe_summary = _classify_ecs_failure_reasons(failure_reasons)
            kind = _classify_ecs_failure_kind(failure_reasons)
            emit_dispatch_metric(f"ECSRunTaskFailed_{kind}", experiment_id)
            return {"status": "failed", "error": f"ECS RunTask failed: {safe_summary}"}

        task_arn = tasks[0]["taskArn"]
        logger.info(f"Started Fargate task: {task_arn}")
        return {"status": "launched", "task_arn": task_arn}

    except Exception as e:
        logger.exception(
            f"ECS RunTask exception (experiment={experiment_id}, "
            f"run={message['run_id']}, exception_type={type(e).__name__}): {e}"
        )
        emit_dispatch_metric("ECSRunTaskException", experiment_id)
        _cleanup_minted_token(broker, minted_broker_token, message["run_id"])
        raise


def handler(event: dict, context) -> dict:
    batch_item_failures = []
    missing_config = _missing_critical_config()

    for record in event.get("Records", []):
        message_id = record.get("messageId", "unknown")
        body = record.get("body", "")

        # When the Lambda is misconfigured (e.g. ENVIRONMENT unset), the strict
        # parse below will raise on dispatches that exercise envelope validation
        # — and that ValueError would otherwise be caught as InvalidDispatchPayload,
        # masking the underlying misconfig. Check config FIRST and route through
        # the dispatch-misconfig callback path. A minimal lenient parse extracts
        # just enough message identity to make the callback useful; the strict
        # parse below validates the envelope only after config is healthy.
        if missing_config:
            try:
                partial = json.loads(body) if body else {}
                shallow: dict = partial if isinstance(partial, dict) else {}
            except (json.JSONDecodeError, TypeError):
                shallow = {}
            shallow.setdefault("run_id", "unknown")
            shallow.setdefault("experiment_type", "_unknown")
            shallow.setdefault("organization_slug", "unknown")
            logger.error(
                f"Dispatch Lambda misconfigured: missing required env vars "
                f"{missing_config} (run: {shallow['run_id']}). "
                f"Message will be retried via SQS until operator fixes config."
            )
            send_error_callback(
                shallow,
                f"Dispatch Lambda misconfigured: missing required env vars {missing_config}",
                RESULTS_QUEUE_URL,
                dedup_id=f"dispatch-misconfig-{shallow['run_id']}",
            )
            batch_item_failures.append({"itemIdentifier": message_id})
            continue

        try:
            message = parse_dispatch_message(body)
        except ValueError as e:
            logger.error(f"Invalid message {message_id}: {e}")
            emit_dispatch_metric("InvalidDispatchPayload", "_unknown")
            # gp-api creates the run row as QUEUED and its stale sweep is
            # RUNNING-only, so a malformed message orphans that row until the
            # slow 6h backstop. Best-effort recover run_id and notify so gp-api
            # can fail the row now. Mirror the dispatch-misconfig callback path.
            try:
                partial = json.loads(body) if isinstance(body, str) else {}
            except Exception:
                partial = {}
            if partial.get("run_id") and RESULTS_QUEUE_URL:
                # Same pattern as the other permanent-fault paths: only retry the
                # SQS message (toward the DLQ) if the callback did NOT reach gp-api.
                # Retrying after a successful callback is pointless churn, and a
                # later retry whose callback fails would re-orphan the QUEUED row.
                sent = send_error_callback(
                    partial,
                    f"Malformed dispatch message: {e}",
                    RESULTS_QUEUE_URL,
                    dedup_id=f"invalid-payload-{partial['run_id']}",
                )
                if not sent:
                    batch_item_failures.append({"itemIdentifier": message_id})
            else:
                # No run_id or no queue URL — can't notify gp-api; send to the
                # DLQ for operator alarms. A judge run id takes the branch
                # above and lands here too: `send_error_callback` suppresses
                # the send and reports False, so the message reaches the DLQ
                # without a callback.
                batch_item_failures.append({"itemIdentifier": message_id})
            continue

        experiment_id = message["experiment_type"]
        try:
            experiment, known_ids = _resolve_routing(experiment_id, run_id=message["run_id"])
        except ManifestLoaderTransientError:
            # SQS retry — usually self-heals during AWS weather. No callback;
            # leave gp-api's run row in PENDING so the next attempt updates it.
            batch_item_failures.append({"itemIdentifier": message_id})
            continue
        except ManifestLoaderMalformedError as e:
            # Publish-pipeline bug. Don't retry forever — surface to gp-api.
            send_error_callback(
                message,
                f"Experiment manifest is malformed: {e}. Operator action required.",
                RESULTS_QUEUE_URL,
                dedup_id=f"manifest-malformed-{message['run_id']}",
            )
            batch_item_failures.append({"itemIdentifier": message_id})
            continue

        if experiment is None:
            logger.error(
                f"Unknown experiment '{experiment_id}' in message {message_id}. Known experiments: {known_ids}"
            )
            emit_dispatch_metric("UnknownExperiment", experiment_id)
            # Design choice (A): send error callback AND add to batch_item_failures.
            # gp-api gets immediate PENDING->FAILED feedback; SQS retries the message
            # so it eventually lands in the DLQ for operator alarms. We pass a
            # stable dedup_id keyed on run_id so retries within FIFO's 5-minute
            # dedup window do NOT generate duplicate callbacks to gp-api.
            send_error_callback(
                message,
                f"Unknown experiment: {experiment_id}",
                RESULTS_QUEUE_URL,
                dedup_id=f"unknown-experiment-{message['run_id']}",
            )
            batch_item_failures.append({"itemIdentifier": message_id})
            continue

        if not isinstance(message["params"], dict):
            type_name = type(message["params"]).__name__
            logger.error(
                f"Invalid params type for {experiment_id} "
                f"(run: {message['run_id']}, organization: {message['organization_slug']}): "
                f"got {type_name}, expected object"
            )
            emit_dispatch_metric("InvalidParamsType", experiment_id)
            sent = send_error_callback(
                message,
                f"params must be a JSON object, got {type_name}",
                RESULTS_QUEUE_URL,
                dedup_id=f"invalid-params-type-{message['run_id']}",
            )
            if not sent:
                batch_item_failures.append({"itemIdentifier": message_id})
            continue

        params_json = json.dumps(message["params"])
        params_bytes = len(params_json.encode("utf-8"))
        if params_bytes > MAX_PARAMS_JSON_BYTES:
            logger.error(
                f"Params too large for {experiment_id} "
                f"(run: {message['run_id']}, organization: {message['organization_slug']}): "
                f"{params_bytes} bytes > {MAX_PARAMS_JSON_BYTES}"
            )
            emit_dispatch_metric("ParamsTooLarge", experiment_id)
            sent = send_error_callback(
                message,
                f"Experiment parameters exceed size limit ({params_bytes} > {MAX_PARAMS_JSON_BYTES} bytes)",
                RESULTS_QUEUE_URL,
                dedup_id=f"params-too-large-{message['run_id']}",
            )
            if not sent:
                batch_item_failures.append({"itemIdentifier": message_id})
            continue

        if message.get("_input_files"):
            input_files_json = json.dumps(message["_input_files"])
            input_files_bytes = len(input_files_json.encode("utf-8"))
            if input_files_bytes > MAX_INPUT_FILES_JSON_BYTES:
                logger.error(
                    f"_input_files too large for {experiment_id} "
                    f"(run: {message['run_id']}, organization: {message['organization_slug']}): "
                    f"{input_files_bytes} bytes > {MAX_INPUT_FILES_JSON_BYTES}"
                )
                emit_dispatch_metric("InputFilesJsonTooLarge", experiment_id)
                sent = send_error_callback(
                    message,
                    f"_input_files serialized size exceeds limit "
                    f"({input_files_bytes} > {MAX_INPUT_FILES_JSON_BYTES} bytes)",
                    RESULTS_QUEUE_URL,
                    dedup_id=f"input-files-too-large-{message['run_id']}",
                )
                if not sent:
                    batch_item_failures.append({"itemIdentifier": message_id})
                continue

        # Validate the dispatch message's params against the manifest's
        # input_schema (JSON Schema Draft-07). The meta-schema makes
        # input_schema required — an empty/missing one here means a
        # publish-pipeline bug, treat it as malformed.
        input_schema = experiment.get("input_schema") or {}
        if not input_schema:
            logger.error(
                f"manifest for {experiment_id} has no input_schema (run: {message['run_id']}). Treating as malformed."
            )
            send_error_callback(
                message,
                f"Experiment manifest is malformed: {experiment_id} has no input_schema.",
                RESULTS_QUEUE_URL,
                dedup_id=f"manifest-no-input-schema-{message['run_id']}",
            )
            batch_item_failures.append({"itemIdentifier": message_id})
            continue

        violations = format_validation_errors(
            _input_validator(experiment_id, experiment.get("manifest_version_id"), input_schema),
            message["params"],
        )
        if violations:
            logger.error(
                f"input_schema validation failed for {experiment_id} "
                f"(run: {message['run_id']}, organization: {message['organization_slug']}): "
                f"{violations}"
            )
            emit_dispatch_metric("InputSchemaViolation", experiment_id)
            sent = send_error_callback(
                message,
                f"Params for {experiment_id} failed input_schema: {violations}",
                RESULTS_QUEUE_URL,
                dedup_id=f"input-schema-{message['run_id']}",
            )
            if not sent:
                batch_item_failures.append({"itemIdentifier": message_id})
            continue

        # Write-action experiments (ENG-10128) get an empty scope dict. The
        # broker creates the Clerk actor token from MintRequest.clerk_user_id
        # and stores the resulting clerk_session_id on the ScopeTicket; it
        # then mints fresh ~60s JWTs for each MCP call the runner makes to
        # /agent/mcp. No per-experiment allowlist is enforced today — every
        # @McpTool-decorated endpoint on gp-api is exposed to every agent
        # run; a real allowlist is future work.
        #
        # Discriminator: `system_prompt` OR `permission_mode` present in the
        # projected routing dict. Both are Claude Agent SDK signals that only
        # appear on write-action manifests. `allowed_external_tools` is NOT a
        # discriminator — a future read-action experiment could plausibly
        # declare extra non-gp-api tools (e.g. WebFetch) without being
        # write-action. The manifest loader validates each write-action field
        # independently, so we mirror its any-of pattern here for the fields
        # that actually signal write-action semantics.
        #
        # `derive_scope` raises ValueError when read-experiment params slip
        # past `input_schema` but still violate stricter checks (state/city/
        # district control characters). An uncaught ValueError here would
        # crash the Lambda invocation — no batchItemFailures, no error
        # callback, every remaining record in the SQS batch unprocessed.
        # Treat the same as an input_schema violation: client-fault, surface
        # to gp-api with a stable dedup so FIFO retries don't duplicate.
        try:
            if _is_write_action(experiment):
                scope: dict = {}
            else:
                scope = derive_scope(
                    experiment_id,
                    message["params"],
                    manifest_scope=experiment.get("scope"),
                )
        except ValueError as e:
            logger.error(
                f"Scope derivation failed for {experiment_id} "
                f"(run: {message['run_id']}, organization: {message['organization_slug']}): {e}"
            )
            emit_dispatch_metric("ScopeDerivationError", experiment_id)
            sent = send_error_callback(
                message,
                f"Params for {experiment_id} failed scope derivation: {e}",
                RESULTS_QUEUE_URL,
                dedup_id=f"scope-derivation-{message['run_id']}",
            )
            if not sent:
                batch_item_failures.append({"itemIdentifier": message_id})
            continue

        # No judge run of a write-action experiment, override arm or base arm.
        # `_resolve_judge_override` refuses the override arm because the
        # behavior allowlist cannot carry system_prompt / permission_mode; the
        # base arm needs its own refusal for a different and worse reason. A
        # write-action run writes to gp-api through the broker's /agent/mcp
        # proxy, which does not read `ticket.is_eval` — so a judge base arm
        # would make real product writes on a real organization while every
        # signal that would surface them is suppressed.
        if message["run_id"].startswith(JUDGE_RUN_ID_PREFIX) and _is_write_action(experiment):
            logger.error(
                f"Judge dispatch refused for write-action experiment {experiment_id} (run: {message['run_id']})"
            )
            emit_dispatch_metric("JudgeWriteActionRefused", experiment_id)
            batch_item_failures.append({"itemIdentifier": message_id})
            continue

        # Judge override, resolved AFTER the real experiment's scope, routing
        # and input_schema are settled above — that ordering is the invariant:
        # the override can only add behavior on top of an already-derived scope,
        # never participate in deriving it.
        override: dict | None = None
        if message.get("_judge_override") is not None:
            try:
                override = _resolve_judge_override(message["_judge_override"], experiment, experiment_id)
            except ManifestLoaderTransientError:
                batch_item_failures.append({"itemIdentifier": message_id})
                continue
            except (ManifestLoaderMalformedError, ValueError) as e:
                logger.error(f"Judge override rejected for {experiment_id} (run: {message['run_id']}): {e}")
                emit_dispatch_metric("JudgeOverrideRejected", experiment_id)
                # Straight to the DLQ, with no callback: an override can only
                # ride a judge run id, and `send_error_callback` suppresses a
                # judge run's callback in any case, because a judge dispatch
                # has no gp-api `experiment_run` row for one to land on.
                batch_item_failures.append({"itemIdentifier": message_id})
                continue

        import time as _time

        try:
            from .job_store import QueuedJob
        except ImportError:
            from job_store import QueuedJob  # type: ignore[no-redef]

        routing = {
            "model": experiment["model"],
            "timeout_seconds": experiment.get("timeout_seconds", 600),
            "manifest_version_id": experiment.get("manifest_version_id"),
            "instruction_version_id": experiment.get("instruction_version_id"),
            "attachment_version_ids": experiment.get("attachment_version_ids"),
            "scope": scope,
        }
        if override is not None:
            # The allowlisted behavior fields become this run's effective
            # routing, and the version pins move to the override objects
            # because those are the bytes the broker will serve: the runner
            # forwards MANIFEST_VERSION_ID / INSTRUCTION_VERSION_ID to the
            # broker's manifest fetch, so keeping the published pins here would
            # ask S3 for a VersionId belonging to a different object. `scope`
            # above is untouched — it came from the published manifest and an
            # override can never widen it.
            behavior = override["behavior"]
            allowlist = override["ticket_allowlist"]
            routing["model"] = behavior["model"]
            if "timeout_seconds" in behavior:
                routing["timeout_seconds"] = behavior["timeout_seconds"]
            routing["manifest_version_id"] = allowlist["manifest_version_id"]
            routing["instruction_version_id"] = allowlist["instruction_version_id"]
            # Rides `routing` rather than a new QueuedJob column so the
            # scheduler threads it to launch_run unchanged: `_launch_one` passes
            # the whole routing dict through as `experiment`.
            routing["judge_override"] = allowlist
        try:
            get_job_store().put_queued_job(
                QueuedJob(
                    run_id=message["run_id"],
                    experiment_type=experiment_id,
                    organization_slug=message["organization_slug"],
                    clerk_user_id=message.get("clerk_user_id"),
                    priority=message["priority"],
                    params=message["params"],
                    routing=routing,
                    prior_artifact_versions=message.get("prior_artifact_versions"),
                    # User-input prefetch (develop): the broker MintRequest field
                    # is `input_files`; the dispatch envelope carries it as
                    # `_input_files` (extracted out of params). Persist it on the
                    # job so the scheduler can thread it into launch_run's mint.
                    input_files=message.get("_input_files"),
                    created_at_ms=int(_time.time() * 1000),
                )
            )
        except Exception as e:
            logger.exception(f"Failed to enqueue job for run {message['run_id']}: {e}")
            emit_dispatch_metric("JobEnqueueFailed", experiment_id)
            batch_item_failures.append({"itemIdentifier": message_id})
            continue
        emit_dispatch_metric("JobEnqueued", experiment_id)
        # Arrival is picked up by the scheduler via the table's DynamoDB stream;
        # no explicit invoke needed here.

    return {"batchItemFailures": batch_item_failures}


_ECS_FAILURE_KIND_TO_USER_MESSAGE = {
    "Capacity": "capacity exhausted (see server logs for detail)",
    "IAM": "permission error (see server logs for detail)",
    "Throttled": "throttled by AWS (see server logs for detail)",
    "Other": "capacity or permission error (see server logs for detail)",
}


def _classify_ecs_failure_kind(reasons: list[str]) -> str:
    """Classify ECS RunTask failure reasons into a stable kind tag used for
    BOTH the user-facing message (via the table above) AND the CloudWatch
    metric dimension. Single source of truth so the two never drift."""
    joined_upper = " ".join(str(r).upper() for r in reasons)
    if "CAPACITY" in joined_upper or "RESOURCE:" in joined_upper:
        return "Capacity"
    if "ACCESSDENIED" in joined_upper or "NOT AUTHORIZED" in joined_upper or "IAM" in joined_upper:
        return "IAM"
    if "THROTTL" in joined_upper:
        return "Throttled"
    return "Other"


def _classify_ecs_failure_reasons(reasons: list[str]) -> str:
    return _ECS_FAILURE_KIND_TO_USER_MESSAGE[_classify_ecs_failure_kind(reasons)]


def _cleanup_minted_token(broker, broker_token: str, run_id: str) -> None:
    try:
        broker.delete_run_token(broker_token=broker_token, run_id=run_id)
    except Exception as e:
        logger.warning(
            f"Failed to delete run-token for run {run_id} after ECS failure: "
            f"{type(e).__name__}: {e}. Ticket + run-lock will expire via TTL."
        )
