import asyncio
import json
import logging
import os
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from broker.auth import get_service_token, verify_service_token
from broker.dynamodb_client import (
    JUDGE_RUN_ID_MAX_LENGTH,
    JUDGE_RUN_ID_PREFIX,
    JUDGE_RUN_ID_RE,
    ExperimentOverrideRef,
    InputFileRef,
    ScopeTicket,
    ScopeTicketStore,
    TicketAlreadyExistsError,
)

# THE MANIFEST ENDPOINT'S PROVIDERS, reused rather than redeclared. Every other
# endpoint declares its own NotImplementedError stubs and main.py overrides
# each one — but nothing tests that wiring against the real app, and a
# forgotten override here would 500 every judge mint. These two are already
# overridden in main.py and exercised on every manifest read, so reusing them
# adds no new way to fail. test_mint_run_token.py pins the reuse, so a later
# swap to a local stub fails a test instead of production.
from broker.endpoints.experiment_manifest import (
    _fetch_object,
    get_experiment_metadata_bucket,
    get_s3_client,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])

# 48h ceiling supports long-running campaign-plan and similar runs. The actual
# ceiling is bounded by the Clerk session lifetime (default 7 days), not what
# we set here — so 48h is comfortably within Clerk's bounds.
# The published-manifest fields an override cannot carry. A judge override is
# served IN PLACE of the published manifest, and dispatch's behavior allowlist
# admits none of these — so a run overriding an experiment that sets one
# would silently lose it, and the sweep would measure that loss instead of
# the branch. Dispatch refuses such an override before minting (its
# `_WRITE_ACTION_DISCRIMINATORS` plus the `allowed_external_tools` check);
# this re-establishes the same refusal here, because a SERVICE_TOKEN holder
# is authenticated rather than trusted and can call this endpoint without
# going through dispatch at all.
#
# A separate copy, like JUDGE_RUN_ID_RE, because the broker and the dispatch
# Lambda are separate members. test_mint_run_token.py asserts it equals the
# set dispatch refuses, so the two cannot drift apart unnoticed.
JUDGE_OVERRIDE_REFUSED_FIELDS = ("system_prompt", "permission_mode", "allowed_external_tools")

MAX_TTL_SECONDS = 172800
# The ticket must outlive the experiment's timeout so the agent's final
# publish/report_status calls don't get 401'd mid-stride (which leaves the
# DB row stuck RUNNING forever). Buffer covers validation + upload + callback.
TTL_BUFFER_SECONDS = 300

# The only ENVIRONMENT an `experiment_override` is honored in, mirroring the
# dispatch Lambda's `_JUDGE_OVERRIDE_ENVIRONMENT`. Terraform sets this to
# exactly "dev" or "prod".
JUDGE_OVERRIDE_ENVIRONMENT = "dev"


IDENTIFIER_PATTERN = r"^[a-zA-Z0-9_-]{1,64}$"


class MintRequest(BaseModel):
    # Every field here has to be consumed below — a mint field this model
    # merely accepts is an authorization the ticket never carries, which is
    # exactly how the judge override shipped inert once. Forbidding extras
    # makes the next such drift a 422 at the first request instead of a
    # silent drop.
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(..., pattern=IDENTIFIER_PATTERN)
    organization_slug: str = Field(..., pattern=IDENTIFIER_PATTERN)
    experiment_id: str = Field(..., pattern=IDENTIFIER_PATTERN)
    scope: dict
    params: dict
    # Optional: when omitted, mint skips the Clerk actor-token round trip and
    # the resulting ticket has clerk_session_id=None. Routes that need MCP-proxy
    # auth (agent_mcp_proxy) will reject such tickets with a clear error;
    # /http/fetch, /pdf/fetch, artifact_* don't need Clerk and work fine.
    clerk_user_id: str | None = None
    exp_ttl_seconds: int = 3600
    # Optional — when provided, mint floors exp_ttl_seconds at
    # timeout_seconds + TTL_BUFFER_SECONDS so ticket survives the whole run.
    timeout_seconds: int | None = None
    # Optional — map of dependency experiment_id -> pinned S3 artifact key.
    # When set, artifact_read enforces that dependents read the exact snapshot
    # dispatched against, preserving the STALE invariant for any experiment
    # with downstream dependencies.
    prior_artifact_versions: dict[str, str] | None = None
    # Optional — enumerated S3 refs the runner is authorized to pre-fetch on
    # behalf of the agent (e.g. user-uploaded agenda PDFs). Each entry is a
    # {bucket, key, dest} ref; /inputs/read enforces exact (bucket, key) match
    # against this list. Refs travel through gp-api's dispatch and dispatch
    # handler strips the `_input_files` envelope key from params before
    # validating against the manifest input_schema.
    input_files: list[InputFileRef] | None = None
    # Universal Judge. `is_eval` marks a run gp-api has no `experiment_run`
    # row for (the judge dispatches straight to SQS), so the broker must never
    # send it a results callback. Separate from `experiment_override` because a
    # sweep's base arm runs the published bytes with no override at all and its
    # callback has to be suppressed too.
    is_eval: bool = False
    # Optional — the one `_judge/<agentId>/<configDigest>/` key pair, version
    # pinned, that /experiment/manifest may serve this run in place of the
    # published `<experiment_id>/*` pair. The dispatch Lambda has already read
    # the override manifest and vetted every field it will honor; this is the
    # allowlist that lets the broker serve the same bytes it vetted.
    experiment_override: ExperimentOverrideRef | None = None


class MintResponse(BaseModel):
    broker_token: str
    exp: int
    params_clean: dict


def _expected_inputs_bucket() -> str:
    """The only S3 bucket `input_files` refs may name in this environment.

    The broker task role also holds GetObject on the artifact and
    experiment-metadata buckets, so without this gate a caller with a valid
    SERVICE_TOKEN could mint a ticket whose input_files point /inputs/read at
    those buckets and read another run's data. Mirrors the dispatch handler's
    `_expected_inputs_bucket` and the agent-run-inputs Terraform bucket name.
    Defaults to `dev` when ENVIRONMENT is unset, matching the broker's other
    env-derived bucket names (see main.py); a wrong default only ever rejects
    a mismatched ref, never widens access.
    """
    env = os.environ.get("ENVIRONMENT", "dev").strip().lower()
    return f"gp-agent-run-inputs-{env}"


def _validate_input_files_bucket(request_input_files, run_id: str) -> None:
    if not request_input_files:
        return
    expected_bucket = _expected_inputs_bucket()
    for ref in request_input_files:
        if ref.bucket != expected_bucket:
            logger.warning(
                "mint_run_token input_file_bucket_rejected run_id=%s bucket=%r expected=%r",
                run_id,
                ref.bucket,
                expected_bucket,
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"input_files bucket {ref.bucket!r} not allowed; "
                    f"only {expected_bucket!r} may be referenced for this run"
                ),
            )


def _validate_judge_fields(
    override: ExperimentOverrideRef | None,
    experiment_id: str,
    is_eval: bool,
    run_id: str,
) -> None:
    """Bind the two judge fields to each other, to the run id, and to the agent.

    A SERVICE_TOKEN holder is authenticated, not trusted, so every judge
    invariant the dispatch Lambda establishes is re-established here.

    `is_eval` is checked against the run-id prefix in BOTH directions, the run
    id is then held to the dispatch Lambda's whole shape, and `is_eval` is
    honored in `dev` only. The prefix binding is the load-bearing one: `is_eval` makes the broker drop this run's success
    callback (`artifact_publish`) and every terminal status (`run_status`), so
    without the binding a token holder could mint `is_eval=true` against a real
    UUIDv7 run id and a genuine product failure would never reach gp-api — the
    row would hang until the 45-minute stale sweep. The converse direction is a
    wiring bug rather than an attack: a judge run id minted without `is_eval`
    posts callbacks gp-api cannot match, one error per run.

    The shape check is `JUDGE_RUN_ID_RE.fullmatch`, the same regex dispatch
    uses, not just its length bound: a validator that accepts a shape the next
    layer rejects is the defect, so this mirrors the layer it stands in for.
    The bound itself is the ECS `startedBy` ceiling dispatch sizes the run id
    against before passing it to RunTask verbatim, and the one the task reaper
    reads back to identify the run.

    `ExperimentOverrideRef` already pins the key shape and the shared folder,
    and `ScopeTicket` re-checks the agent binding on load. Raising here turns
    each into a 400 the caller can read instead of a 500 from a pydantic error
    inside the handler.
    """
    judge_run_id = run_id.startswith(JUDGE_RUN_ID_PREFIX)
    if is_eval != judge_run_id:
        logger.warning(
            "mint_run_token is_eval_run_id_mismatch run_id=%s experiment_id=%s is_eval=%s",
            run_id,
            experiment_id,
            is_eval,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"is_eval must be true exactly when run_id is prefixed {JUDGE_RUN_ID_PREFIX!r}; "
                "is_eval suppresses this run's results callbacks, so it may only be set for a run "
                "gp-api has no experiment_run row for"
            ),
        )
    # Shape, not just prefix. Mirrors `_validate_judge_dispatch`, which
    # `fullmatch`es the same regex and refuses the dispatch outright — so
    # without this the broker mints a live ticket for a judge run id the
    # Lambda above it will never dispatch, and nothing downstream re-checks it.
    if judge_run_id and JUDGE_RUN_ID_RE.fullmatch(run_id) is None:
        # Logged, not echoed: the run id is caller-controlled, and the other
        # judge rejections keep it out of the 400 body too. Safe to log —
        # `IDENTIFIER_PATTERN` has already bounded it to 64 characters of
        # `[a-zA-Z0-9_-]`, so there is no newline to forge a log line with.
        logger.warning(
            "mint_run_token judge_run_id_malformed run_id=%s run_id_length=%d experiment_id=%s",
            run_id,
            len(run_id),
            experiment_id,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"a judge run_id must match {JUDGE_RUN_ID_RE.pattern}; dispatch passes the run id "
                f"to ECS RunTask as startedBy verbatim and refuses anything over "
                f"{JUDGE_RUN_ID_MAX_LENGTH} characters, so a ticket minted for a longer one is a "
                "ticket for a run that cannot be dispatched"
            ),
        )
    # Dev-only on `is_eval`, not just on the override: a sweep's base arm sets
    # `is_eval` with no override at all, and gets every consequence of it —
    # both callback senders silenced and the org's `latest.json` left alone. In
    # prod that is a run spending real money that gp-api has no row for and no
    # signal about. An allowlist rather than a deny-prod check, and
    # deliberately without the permissive "dev" default
    # `_expected_inputs_bucket` uses, so an unexpected ENVIRONMENT refuses.
    # Mirrors the dispatch Lambda's `_validate_judge_dispatch` so the
    # documented dev-only property holds at both layers, not only upstream.
    if is_eval:
        env = os.environ.get("ENVIRONMENT", "").strip().lower()
        if env != JUDGE_OVERRIDE_ENVIRONMENT:
            logger.warning(
                "mint_run_token eval_wrong_environment run_id=%s experiment_id=%s environment=%r",
                run_id,
                experiment_id,
                env,
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"an eval run is only accepted when ENVIRONMENT is "
                    f"{JUDGE_OVERRIDE_ENVIRONMENT!r}; this broker has {env!r}"
                ),
            )
    if override is None:
        return
    if not is_eval:
        logger.warning(
            "mint_run_token override_without_is_eval run_id=%s experiment_id=%s",
            run_id,
            experiment_id,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                "experiment_override requires is_eval=true; an override can only come from a judge "
                "dispatch, which has no gp-api run row for a results callback to land on"
            ),
        )
    if override.agent_id != experiment_id:
        logger.warning(
            "mint_run_token override_agent_mismatch run_id=%s experiment_id=%s agent_id=%s",
            run_id,
            experiment_id,
            override.agent_id,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"experiment_override agentId segment {override.agent_id!r} does not match "
                f"experiment_id {experiment_id!r}"
            ),
        )


def _published_fields_an_override_cannot_carry(s3_client, bucket: str, experiment_id: str, run_id: str) -> list[str]:
    """Which of JUDGE_OVERRIDE_REFUSED_FIELDS the PUBLISHED manifest sets.

    The published manifest, not the override: the override is what the
    candidate arm is about to run INSTEAD, so it is the published one whose
    fields would be lost. Read at latest — dispatch reads routing at dispatch
    time from the same object, and a publish landing in between can only make
    this refuse more, never less.

    Fails closed. A missing published manifest is a 404 from `_fetch_object`;
    one that is not a JSON object is refused here. Either way no ticket is
    minted, which is the safe direction: dispatch mints before it launches the
    Fargate task, so a refusal here costs nothing.
    """
    body, _ = _fetch_object(
        s3_client,
        bucket,
        f"{experiment_id}/manifest.json",
        run_id,
        label="published manifest",
    )
    try:
        manifest = json.loads(body)
    except (ValueError, UnicodeDecodeError) as err:
        raise HTTPException(
            status_code=500,
            detail="the published manifest is not valid JSON, so an override against it cannot be vetted",
        ) from err
    if not isinstance(manifest, dict):
        raise HTTPException(
            status_code=500,
            detail="the published manifest is not a JSON object, so an override against it cannot be vetted",
        )
    return [field for field in JUDGE_OVERRIDE_REFUSED_FIELDS if manifest.get(field) is not None]


def get_ticket_store():
    raise NotImplementedError("must be overridden via dependency_overrides")  # pragma: no cover


def get_service_token_hash():
    raise NotImplementedError("must be overridden via dependency_overrides")  # pragma: no cover


@router.post("/mint-run-token", response_model=MintResponse)
async def mint_run_token(
    request: MintRequest,
    service_token: str = Depends(get_service_token),
    token_hash: str = Depends(get_service_token_hash),
    store: ScopeTicketStore = Depends(get_ticket_store),
    s3_client=Depends(get_s3_client),
    metadata_bucket: str = Depends(get_experiment_metadata_bucket),
):
    if not verify_service_token(service_token, token_hash):
        logger.warning(
            "mint_run_token invalid_service_token run_id=%s experiment_id=%s",
            getattr(request, "run_id", "unknown"),
            getattr(request, "experiment_id", "unknown"),
        )
        raise HTTPException(status_code=401, detail="Invalid service token")

    _validate_input_files_bucket(request.input_files, request.run_id)
    _validate_judge_fields(
        request.experiment_override,
        request.experiment_id,
        request.is_eval,
        request.run_id,
    )
    # After the cheap checks, so a malformed request never costs an S3 read,
    # and only when there is an override: a base arm and every production run
    # mint with none, and must not gain a dependency on S3 here.
    if request.experiment_override is not None:
        lost = await asyncio.to_thread(
            _published_fields_an_override_cannot_carry,
            s3_client,
            metadata_bucket,
            request.experiment_id,
            request.run_id,
        )
        if lost:
            logger.warning(
                "mint_run_token override_would_drop_fields run_id=%s experiment_id=%s fields=%s",
                request.run_id,
                request.experiment_id,
                ",".join(lost),
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"experiment_override is not supported for {request.experiment_id!r}: its published "
                    f"manifest sets {', '.join(lost)}, which an override cannot carry, so the candidate arm "
                    "would silently lose it and the comparison would measure that loss instead of the branch"
                ),
            )

    broker_token = str(uuid.uuid4())
    now = int(time.time())

    if request.exp_ttl_seconds > MAX_TTL_SECONDS:
        logger.warning(
            "mint_run_token ttl_above_cap run_id=%s experiment_id=%s exp_ttl_seconds=%d max=%d",
            request.run_id,
            request.experiment_id,
            request.exp_ttl_seconds,
            MAX_TTL_SECONDS,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"exp_ttl_seconds={request.exp_ttl_seconds} exceeds "
                f"MAX_TTL_SECONDS ({MAX_TTL_SECONDS}s); silent clamping would "
                "let an agent 401 mid-run and leave the row stuck RUNNING"
            ),
        )

    effective_ttl = request.exp_ttl_seconds
    if request.timeout_seconds is not None:
        required_ttl = request.timeout_seconds + TTL_BUFFER_SECONDS
        if required_ttl > MAX_TTL_SECONDS:
            logger.warning(
                "mint_run_token timeout_plus_buffer_above_cap run_id=%s "
                "experiment_id=%s timeout_seconds=%d buffer=%d max=%d",
                request.run_id,
                request.experiment_id,
                request.timeout_seconds,
                TTL_BUFFER_SECONDS,
                MAX_TTL_SECONDS,
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"timeout_seconds={request.timeout_seconds} + buffer "
                    f"({TTL_BUFFER_SECONDS}s) exceeds MAX_TTL_SECONDS "
                    f"({MAX_TTL_SECONDS}s); this experiment is misconfigured"
                ),
            )
        effective_ttl = max(effective_ttl, required_ttl)

    exp = now + effective_ttl

    ticket = ScopeTicket(
        pk=broker_token,
        run_id=request.run_id,
        organization_slug=request.organization_slug,
        experiment_id=request.experiment_id,
        scope=request.scope,
        params=request.params,
        exp=exp,
        issued_at=now,
        issued_by="dispatch_lambda",
        prior_artifact_versions=request.prior_artifact_versions,
        clerk_user_id=request.clerk_user_id,
        input_files=request.input_files,
        is_eval=request.is_eval,
        experiment_override=request.experiment_override,
    )

    try:
        store.put_ticket(ticket)
    except TicketAlreadyExistsError:
        logger.warning(
            "mint_run_token ticket_already_exists run_id=%s experiment_id=%s",
            request.run_id,
            request.experiment_id,
        )
        raise HTTPException(status_code=409, detail="Ticket already exists") from None

    logger.info(
        "mint_run_token ok run_id=%s experiment_id=%s exp=%d clerk_user=%s is_eval=%s experiment_override=%s",
        request.run_id,
        request.experiment_id,
        exp,
        "present" if request.clerk_user_id else "absent",
        request.is_eval,
        request.experiment_override.manifest_key if request.experiment_override else "absent",
    )

    return MintResponse(
        broker_token=broker_token,
        exp=exp,
        params_clean=request.params,
    )
