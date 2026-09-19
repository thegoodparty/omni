"""Config for an autopilot stage run: the envelope the Fargate task gets from
the conductor, parsed the same way engineer_agent/agent/config.py parses its
own run's envelope — see that file's DEFAULT_MAX_BUDGET_USD /
DEFAULT_DEADLINE_SECONDS comment for why every run gets both a budget and a
deadline ceiling rather than either alone.

Autopilot's ceilings are per STAGE rather than one flat default: an
epic-create run only plans, a story run reads and writes code, and a qa run
mostly reads — they do not cost the same to bound.
"""

import math
import os
from dataclasses import dataclass

# The four stages this harness knows how to run. Each has an instruction file
# at agent/stages/<stage>.md (real content lands in later tasks of this epic;
# this task ships stubs). "resume" has no ceiling default of its own — see
# _resolve_ceilings.
STAGES = ("epic-create", "story", "qa", "resume")

# (max_budget_usd, deadline_seconds) per stage. Ceilings, not targets: a
# normal run lands far under either — these bound the pathological run that
# has stopped making progress and is re-reading the same files.
STAGE_CEILINGS: dict[str, tuple[float, float]] = {
    "epic-create": (10.0, 30 * 60),
    "story": (15.0, 45 * 60),
    "qa": (8.0, 45 * 60),
}


class UnknownStageError(ValueError):
    """A stage was named (AUTOPILOT_STAGE, or RESUME_STAGE for a resume run)
    that this harness has no ceiling default or instruction file for."""


def _positive_float_from_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        value = None
    # isfinite + positive, not just "float() parsed": float() accepts
    # 'nan'/'inf', and either would silently disable the ceiling it was set to
    # enforce — NaN because every comparison against it is False, inf because
    # nothing exceeds it. A typo must fall back to the default loudly enough
    # to find in the log, not quietly remove the guard rail.
    if value is not None and math.isfinite(value) and value > 0:
        return value
    print(f"Invalid {name} env value; using default {default}")
    return default


def _resolve_ceilings(stage: str, resume_stage: str) -> tuple[float, float]:
    """The (budget, deadline) defaults for `stage`.

    A resume run has no ceiling of its own — it inherits whatever stage it is
    resuming, named by RESUME_STAGE, because the work it does picking that run
    back up is that stage's work. Resuming a stage this harness cannot name
    (unset, misspelled, or "resume" itself) is the same failure as an unknown
    AUTOPILOT_STAGE: fail the run rather than guess a ceiling for it.
    """
    target = resume_stage if stage == "resume" else stage
    ceilings = STAGE_CEILINGS.get(target)
    if ceilings is None:
        if stage == "resume":
            raise UnknownStageError(
                f"No ceiling defaults for RESUME_STAGE {target!r}; known stages: {sorted(STAGE_CEILINGS)}"
            )
        raise UnknownStageError(f"No ceiling defaults for stage {target!r}; known stages: {sorted(STAGE_CEILINGS)}")
    return ceilings


CAPABILITIES = {
    "sdk_tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
}


@dataclass
class AgentConfig:
    stage: str
    task_id: str
    epic_task_id: str = ""
    model: str = "opus"
    max_budget_usd: float = 0.0
    deadline_seconds: float = 0.0
    # Starts as the base directory the container mounts; main.py overwrites it
    # with the omni clone's path once workspace.clone_omni succeeds, so this
    # field is what ClaudeAgentOptions.cwd is built from either way.
    workspace_dir: str = "/workspace"
    # Which stage a "resume" run is picking back up. Empty for every other
    # stage — see _resolve_ceilings for why this drives the ceiling defaults
    # rather than "resume" carrying its own.
    resume_stage: str = ""

    @classmethod
    def from_env(cls) -> "AgentConfig":
        stage = os.environ.get("AUTOPILOT_STAGE", "").strip()
        if stage not in STAGES:
            raise UnknownStageError(f"Unknown AUTOPILOT_STAGE {stage!r}; known stages: {STAGES}")

        task_id = os.environ.get("CLICKUP_TASK_ID", "")
        if not task_id:
            raise ValueError("CLICKUP_TASK_ID environment variable required")

        resume_stage = os.environ.get("RESUME_STAGE", "").strip()
        default_budget, default_deadline = _resolve_ceilings(stage, resume_stage)

        return cls(
            stage=stage,
            task_id=task_id,
            epic_task_id=os.environ.get("EPIC_TASK_ID", ""),
            model=os.environ.get("AGENT_MODEL", "opus"),
            max_budget_usd=_positive_float_from_env("AGENT_MAX_BUDGET_USD", default_budget),
            deadline_seconds=_positive_float_from_env("AGENT_DEADLINE_SECONDS", default_deadline),
            workspace_dir=os.environ.get("WORKSPACE_DIR", "/workspace"),
            resume_stage=resume_stage,
        )
