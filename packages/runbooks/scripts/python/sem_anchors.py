"""Read governed metric anchors from gp-data-platform's semantic layer (DATA-2421).

The semantic layer is the kernel. This monitor derives what to watch from the
metric's own `config.meta.anchored_on` rather than a hand-maintained list here,
because a hand-maintained copy is exactly what went stale and let a broken OKR
metric run quiet for a month.

Cross-repo read, so it needs a token. When the token is absent the anchored
checks disable themselves and the rest of the monitor runs unchanged — the
weekly digest is more valuable degraded than not posted at all.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

import yaml

TOKEN_ENV = "GP_DATA_PLATFORM_READ_TOKEN"
REPO = "thegoodparty/gp-data-platform"
SEM_PATHS = (
    "dbt/project/models/marts/analytics/sem_analytics__users_win.yml",
    "dbt/project/models/marts/analytics/sem_analytics__users_serve.yml",
)
_API = "https://api.github.com/repos/{repo}/contents/{path}"
_TIMEOUT = 20


@dataclass(frozen=True)
class Leg:
    """One raw signal that feeds a governed metric."""

    event: str
    path: str | None = None
    era: str | None = None

    @property
    def key(self) -> str:
        """Series key. Path legs need their own key: 'Viewed' is site-wide at 4.46M
        rows and only its '/dashboard' slice is the instrument."""
        return f"{self.event}[path={self.path}]" if self.path else self.event

    @property
    def watched(self) -> bool:
        """Historical legs are kept so old numbers stay right, but they are not
        expected to fire, so watching them would alarm forever."""
        return self.era != "historical"


def parse_anchors(text: str) -> dict[str, list[Leg]]:
    """Parse a sem YAML into ``{metric_name: [Leg, ...]}`` for metrics declaring one."""
    doc = yaml.safe_load(text) or {}
    anchors: dict[str, list[Leg]] = {}
    for metric in doc.get("metrics") or []:
        declared = ((metric.get("config") or {}).get("meta") or {}).get("anchored_on")
        if not declared:
            continue
        legs = []
        for leg in declared:
            event = leg.get("event")
            if not event:
                raise ValueError(
                    f"{metric.get('name')}: every anchored_on leg needs an 'event' key"
                )
            legs.append(Leg(event=event, path=leg.get("path"), era=leg.get("era")))
        anchors[metric["name"]] = legs
    return anchors


def _fetch(path: str, token: str) -> str:
    request = urllib.request.Request(
        _API.format(repo=REPO, path=path),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.raw+json",
            "User-Agent": "gp-analytics-event-health",
        },
    )
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
        return response.read().decode()


def load_anchors(token: str | None = None) -> tuple[dict[str, list[Leg]], list[str]]:
    """All declared anchors across the governed sem files, plus any read failures.

    Degrades rather than crashes when the token is missing or GitHub is unreachable, so
    a provisioning gap does not cost the whole weekly digest. But it returns the reason
    alongside, because a guard that disables itself quietly is the failure mode this
    ticket exists to remove — degrading silently here would rebuild the original bug in
    the alarm itself.

    A malformed declaration is NOT swallowed. That is a real defect in the kernel and
    must raise.
    """
    token = token if token is not None else os.environ.get(TOKEN_ENV)
    if not token:
        return {}, [
            f"{TOKEN_ENV} is not set, so the semantic-layer anchors could not be read. "
            "Every OKR dormancy check is DISABLED this run."
        ]
    anchors: dict[str, list[Leg]] = {}
    problems: list[str] = []
    for path in SEM_PATHS:
        try:
            text = _fetch(path, token)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            problems.append(
                f"could not read {path} from {REPO} ({exc}). Anchors from this file are "
                "not being watched this run."
            )
            continue
        anchors.update(parse_anchors(text))
    return anchors, problems
