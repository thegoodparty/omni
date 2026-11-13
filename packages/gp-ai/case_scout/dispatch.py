"""The `start` Lambda action's ECS RunTask dispatch — launches the Reader's
Fargate task once the night is claimed (lambda/handler.py's own TODO,
infrastructure/modules/case-scout/main.tf's "Nothing calls RunTask against
this task definition yet").

Mirrors autopilot/lambda/dispatch.py's launch_fargate_stage shape (cluster,
task definition, subnets and security group from env; FARGATE launch type;
container overrides carry run-specific values as environment variables; zero
botocore retries since RunTask has no idempotency token) but skips
autopilot's DynamoDB claim layer entirely: the Reader's one-run-a-night
guarantee already comes from bucket.py's claims/<runDate> If-None-Match
write, which _handle_start performs BEFORE calling this function — a second
dedup layer here would be redundant, and copying autopilot's claim table
would need infra this module doesn't have.

Copied in shape, not imported — case_scout's Lambda zip ships only its own
top-level modules (see ai_secrets.py's module docstring for the same
sibling-independence reasoning).
"""

import os
from typing import Any

import boto3
from botocore.config import Config

ECS_CLIENT_CONFIG = Config(connect_timeout=5, read_timeout=30, retries={"total_max_attempts": 1})

READER_CONTAINER_NAME = "case-scout-reader"

_ecs_client: Any = None


def _ecs() -> Any:
    global _ecs_client
    if _ecs_client is None:
        _ecs_client = boto3.client("ecs", config=ECS_CLIENT_CONFIG)
    return _ecs_client


def launch_reader_task(run_date: str) -> dict[str, Any]:
    """Starts the Reader's Fargate task for `run_date`. Fails closed (never
    raises) on missing ECS config — the same posture as autopilot's
    launch_fargate_stage, since a half-configured dispatch should report a
    clean error, not an unhandled exception out of the Lambda handler."""
    cluster_arn = os.environ.get("ECS_CLUSTER_ARN")
    task_definition = os.environ.get("ECS_TASK_DEFINITION")
    subnet_ids = [s for s in os.environ.get("SUBNET_IDS", "").split(",") if s]
    security_group_id = os.environ.get("SECURITY_GROUP_ID")

    if not all([cluster_arn, task_definition, subnet_ids, security_group_id]):
        error_msg = "ECS configuration is missing or incomplete; refusing to launch the Reader"
        print(f"ERROR: {error_msg}")
        return {"launched": False, "error": error_msg}

    print(f"Launching case scout Reader Fargate task for runDate={run_date}")

    try:
        response = _ecs().run_task(
            cluster=cluster_arn,
            taskDefinition=task_definition,
            launchType="FARGATE",
            tags=[{"key": "Project", "value": "case-scout"}],
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
                        "name": READER_CONTAINER_NAME,
                        "environment": [{"name": "CASE_SCOUT_RUN_DATE", "value": run_date}],
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
        # them, but don't propagate past CloudWatch.
        reasons = [f.get("reason", "unknown") for f in failures]
        print(f"ERROR: ECS task launch failed: {', '.join(reasons)}")
        return {"launched": False, "error": "ECS task launch failed"}
    if not tasks:
        print("ERROR: ECS run_task returned no tasks and no failures")
        return {"launched": False, "error": "no tasks returned"}

    task_arn = tasks[0]["taskArn"]
    print(f"Started case scout Reader task: {task_arn}")
    return {"launched": True, "task_arn": task_arn}
