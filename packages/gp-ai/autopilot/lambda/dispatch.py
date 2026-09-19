"""Autopilot conductor: DynamoDB claim + ECS Fargate dispatch.

Copies the SHAPE of clickup_bot's try_acquire_dedup_lock / trigger_fargate_task
(never imports them — see handler.py's module docstring for why the two
Lambdas stay decoupled). One deliberate divergence: clickup_bot's atomic
dedup is a backstop behind a comment-based check, so it fails OPEN when its
table is unreachable; autopilot has no second dedup layer, so an
unconfigured/unreachable claim table FAILS CLOSED here instead — proceeding
without it would let every retry and sweep double-launch a paid Fargate run.
"""

import os
import time
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

# Tight timeouts, zero SDK retries — same rationale as clickup_bot's client
# configs. RunTask has no idempotency token, so a botocore retry after an
# ambiguous failure (a read timeout with the request possibly already
# accepted server-side) can double-launch inside a single claim, which is
# exactly the duplicate class the claim exists to prevent.
DYNAMODB_CLIENT_CONFIG = Config(connect_timeout=2, read_timeout=5, retries={"total_max_attempts": 1})
ECS_CLIENT_CONFIG = Config(connect_timeout=5, read_timeout=30, retries={"total_max_attempts": 1})

# Added on top of the stage's OWN AGENT_DEADLINE_SECONDS budget to compute
# the claim's TTL (see dispatch_stage). The TTL must never be shorter than
# the stage run it is protecting: ClickUp redelivers slow-acked webhooks
# (see handler.py's module docstring) and a claim that expired while a
# same-transition Fargate run was still legitimately executing would let
# that redelivery win a fresh claim and double-launch. This grace window
# covers everything AFTER the run finishes — clock skew and the delay
# before a sweep would otherwise reclaim it — not the run itself.
DEDUP_TTL_GRACE_SECONDS = 300

_dynamodb_client: Any = None
_ecs_client: Any = None

# Stage that must launch on the Playwright-installed task definition instead
# of the base autopilot-agent image (qa.md's stage-runner drives Playwright
# E2E, which the base image doesn't ship). Value duplicated from
# router.STAGE_QA rather than imported — dispatch.py stays import-free of
# router.py by design (see module docstring).
QA_STAGE = "qa"


def get_dynamodb_client() -> Any:
    global _dynamodb_client
    if _dynamodb_client is None:
        _dynamodb_client = boto3.client("dynamodb", config=DYNAMODB_CLIENT_CONFIG)
    return _dynamodb_client


def get_ecs_client() -> Any:
    global _ecs_client
    if _ecs_client is None:
        _ecs_client = boto3.client("ecs", config=ECS_CLIENT_CONFIG)
    return _ecs_client


@dataclass(frozen=True)
class StageEnvelope:
    stage: str
    task_id: str
    epic_task_id: str | None
    model: str
    max_budget_usd: float
    deadline_seconds: int
    # Which stage a resume run re-enters, resolved by the conductor from the
    # card's park marker. Required by the agent's config (RESUME_STAGE) for
    # stage=resume and meaningless otherwise — the first live resume died at
    # agent startup because nothing ever set it.
    resume_stage: str | None = None

    def to_environment(self) -> list[dict[str, str]]:
        environment = [
            {"name": "AUTOPILOT_STAGE", "value": self.stage},
            {"name": "CLICKUP_TASK_ID", "value": self.task_id},
            {"name": "AGENT_MODEL", "value": self.model},
            {"name": "AGENT_MAX_BUDGET_USD", "value": str(self.max_budget_usd)},
            {"name": "AGENT_DEADLINE_SECONDS", "value": str(self.deadline_seconds)},
        ]
        if self.epic_task_id is not None:
            environment.append({"name": "EPIC_TASK_ID", "value": self.epic_task_id})
        if self.resume_stage is not None:
            environment.append({"name": "RESUME_STAGE", "value": self.resume_stage})
        # Forwarded from the conductor's own env, not an envelope field: the
        # agent-side feedback primitives (park, notify) post to this channel,
        # and the task definition carries no channel of its own — without
        # this line every park in every stage dies on "No Slack channel".
        slack_channel = os.environ.get("AUTOPILOT_SLACK_CHANNEL", "").strip()
        if slack_channel:
            environment.append({"name": "AUTOPILOT_SLACK_CHANNEL", "value": slack_channel})
        return environment


def claim_pk(task_id: str, stage: str, transitioned_at: str) -> str:
    return f"{task_id}#{stage}#{transitioned_at}"


def claim_transition(task_id: str, stage: str, transitioned_at: str, ttl_seconds: float) -> str | None:
    """Conditionally claims (task_id, stage, transition timestamp) so retries
    and sweeps can never double-dispatch. None = this call won the claim and
    must proceed with the launch; a non-None string is the failure reason
    ("already claimed", "dedup table not configured", "dedup table
    unavailable") — either way the caller must not launch. Distinct reasons
    matter operationally: a missing env var must not read as a phantom
    duplicate in CloudWatch.

    The transition timestamp in the key is deliberate: a genuine human
    re-entry (a fresh status transition) gets a fresh key, rather than being
    suppressed by an old claim for the same (task, stage).

    ttl_seconds is the CALLER's job to size (dispatch_stage derives it from
    the stage's own AGENT_DEADLINE_SECONDS ceiling plus DEDUP_TTL_GRACE_SECONDS)
    — a flat constant here would risk being shorter than a legitimately
    still-running stage, letting a redelivery reclaim and double-launch it.
    """
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        # Unlike clickup_bot's atomic dedup (a backstop behind a comment
        # check), this claim is autopilot's ONLY dedup layer — see module
        # docstring. Fails CLOSED on purpose.
        print("ERROR: AUTOPILOT_DEDUP_TABLE not configured; refusing to dispatch")
        return "dedup table not configured"

    pk = claim_pk(task_id, stage, transitioned_at)
    expires_at = int(time.time() + ttl_seconds)
    try:
        get_dynamodb_client().put_item(
            TableName=table_name,
            Item={
                "pk": {"S": pk},
                "task_id": {"S": task_id},
                "stage": {"S": stage},
                "expires_at": {"N": str(expires_at)},
            },
            ConditionExpression="attribute_not_exists(pk) OR #exp < :now",
            ExpressionAttributeNames={"#exp": "expires_at"},
            ExpressionAttributeValues={":now": {"N": str(int(time.time()))}},
        )
        return None
    except ClientError as e:
        # Match on Error.Code, not the exception class: boto3 raises
        # factory-generated subclasses, and the code string is the stable
        # contract.
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            print(f"Transition already claimed, skipping dispatch: {pk}")
            return "already claimed"
        print(f"ERROR: dedup table unavailable, refusing to dispatch: {e}")
        return "dedup table unavailable"
    except Exception as e:
        print(f"ERROR: dedup table unavailable, refusing to dispatch: {e}")
        return "dedup table unavailable"


def launch_fargate_stage(envelope: StageEnvelope) -> dict:
    cluster_arn = os.environ.get("ECS_CLUSTER_ARN")

    # A resume OF the qa stage re-runs the QA browser walk, so it needs the
    # browsers exactly as much as a fresh qa dispatch does — the first live
    # resume-of-qa launched on the base image and had nothing to drive
    # Playwright with (ENG-11144).
    needs_playwright = QA_STAGE in (envelope.stage, envelope.resume_stage)

    if needs_playwright:
        # qa runs Playwright E2E against the deployed dev stack; the base
        # autopilot-agent image has no browsers installed, so qa MUST launch
        # on the Playwright family, never fall back to the base one.
        task_definition = os.environ.get("ECS_TASK_DEFINITION_PLAYWRIGHT")
        if not task_definition:
            error_msg = "playwright task definition not configured"
            print(f"ERROR: {error_msg}; refusing qa dispatch")
            return {"launched": False, "error": error_msg}
    else:
        task_definition = os.environ.get("ECS_TASK_DEFINITION")

    subnet_ids = [s for s in os.environ.get("SUBNET_IDS", "").split(",") if s]
    security_group_id = os.environ.get("SECURITY_GROUP_ID")

    if not all([cluster_arn, task_definition, subnet_ids, security_group_id]):
        error_msg = "ECS configuration is missing or incomplete; autopilot cannot start the stage"
        print(f"ERROR: {error_msg}")
        return {"launched": False, "error": error_msg}

    # The agent-side feedback primitives (park, notify) hard-require this
    # channel. A missing value doesn't fail here on its own — it fails inside
    # the container, after the agent has already done real work, when the
    # first park raises "No Slack channel". Fail closed with the rest of the
    # ECS-critical config instead.
    if not os.environ.get("AUTOPILOT_SLACK_CHANNEL", "").strip():
        error_msg = "AUTOPILOT_SLACK_CHANNEL not configured; refusing dispatch"
        print(f"ERROR: {error_msg}")
        return {"launched": False, "error": error_msg}

    print(f"Launching Fargate stage={envelope.stage} for task_id={envelope.task_id}")

    try:
        response = get_ecs_client().run_task(
            cluster=cluster_arn,
            taskDefinition=task_definition,
            launchType="FARGATE",
            tags=[{"key": "Project", "value": "autopilot"}],
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": subnet_ids,
                    "securityGroups": [security_group_id],
                    "assignPublicIp": "DISABLED",
                }
            },
            overrides={
                "containerOverrides": [
                    {
                        # RunTask rejects an override naming a container the
                        # task definition doesn't have, and the Playwright
                        # family's container is named after its own family —
                        # a hardcoded "autopilot-agent" here fails every qa
                        # dispatch at launch.
                        "name": "autopilot-agent-playwright" if needs_playwright else "autopilot-agent",
                        "environment": envelope.to_environment(),
                    }
                ]
            },
        )
    except Exception as e:
        print(f"ERROR: ECS run_task failed: {type(e).__name__}: {e}")
        return {"launched": False, "error": "ECS run_task failed"}

    failures = response.get("failures", [])
    tasks = response.get("tasks", [])
    if failures:
        # Raw failures[].reason strings can embed ARNs/account details: log
        # them, but don't propagate them beyond CloudWatch.
        failure_reasons = [f.get("reason", "unknown") for f in failures]
        print(f"ERROR: ECS task launch failed: {', '.join(failure_reasons)}")
        return {"launched": False, "error": "ECS task launch failed"}
    if not tasks:
        print("ERROR: ECS run_task returned no tasks and no failures")
        return {"launched": False, "error": "no tasks returned"}

    task_arn = tasks[0]["taskArn"]
    print(f"Started Fargate task: {task_arn}")
    return {"launched": True, "task_arn": task_arn}


def dispatch_stage(task_id: str, stage: str, transitioned_at: str, envelope: StageEnvelope) -> dict:
    """Claims the transition, then launches the Fargate stage run.

    Claim strictly BEFORE RunTask: see claim_transition. The claim's TTL is
    the stage's OWN deadline plus a fixed grace window, never a flat
    constant — sized any shorter and a redelivered webhook (ClickUp does
    this; see handler.py's module docstring) could reclaim and double-launch
    a run that is still legitimately executing within its own budget.

    A launch failure AFTER a successful claim is logged loudly but the claim
    is NOT rolled back — deleting it would let a retry within the same
    transition re-attempt the exact launch that just failed. The sweep
    (task 03) plus a fresh transition timestamp on a genuine re-entry is the
    recovery path for a stranded claim.
    """
    ttl_seconds = envelope.deadline_seconds + DEDUP_TTL_GRACE_SECONDS
    reason = claim_transition(task_id, stage, transitioned_at, ttl_seconds)
    if reason is not None:
        return {"dispatched": False, "reason": reason}

    result = launch_fargate_stage(envelope)
    if not result["launched"]:
        print(
            "ERROR: claimed transition failed to launch; claim left in place for the sweep to recover: "
            f"task_id={task_id} stage={stage}"
        )
    return {"dispatched": result["launched"], **result}
