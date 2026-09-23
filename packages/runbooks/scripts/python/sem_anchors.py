"""Read governed metric anchors from gp-data-platform's semantic layer (DATA-2421).

The semantic layer is the kernel. This monitor derives what to watch from the
metric's own `config.meta.anchored_on` rather than a hand-maintained list here,
because a hand-maintained copy is exactly what went stale and let a broken OKR
metric run quiet for a month.

Cross-repo read. CI holds a read token; a human running the monitor without one
falls back to their own `gh` auth instead. Only when both are unavailable do the
anchored checks disable themselves, with the rest of the monitor running
unchanged — the weekly digest is more valuable degraded than not posted at all.
"""

from __future__ import annotations

import http.client
import os
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass

import yaml

TOKEN_ENV = "GP_DATA_PLATFORM_READ_TOKEN"
GH_FALLBACK_ENV = "SEM_ANCHORS_NO_GH"
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


def _fetch_via_gh(path: str) -> str:
    """The reviewer's own GitHub auth. A triage session on a laptop has no reason to
    hold the CI token, and gh already knows who they are."""
    proc = subprocess.run(
        ["gh", "api", "-H", "Accept: application/vnd.github.raw+json",
         f"repos/{REPO}/contents/{path}"],
        capture_output=True, text=True, timeout=_TIMEOUT,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"gh api exited {proc.returncode}")
    return proc.stdout


def load_anchors(token: str | None = None) -> tuple[dict[str, list[Leg]], list[str]]:
    """All declared anchors across the governed sem files, plus any read failures.

    Degrades rather than crashes when the token is missing or GitHub is unreachable, so
    a provisioning gap does not cost the whole weekly digest. But it returns the reason
    alongside, because a guard that disables itself quietly is the failure mode this
    ticket exists to remove — degrading silently here would rebuild the original bug in
    the alarm itself.

    A malformed declaration is reported, not raised. The spec's requirement is "loud,
    never a silent empty watch set", and raising here is loud in the wrong place: it is
    another repo's file, so one bad leg merged in gp-data-platform would fail omni's CI
    step outright — no digest, no Slack post, no state write-back. Routing it into
    ``problems`` is louder in the place that matters (a red digest line and a red Slack
    item) and costs only that one file's anchors. ``parse_anchors`` stays strict for
    direct callers.

    A read that succeeds but finds zero anchored_on blocks is ALSO not swallowed: that
    is the live condition while gp-data-platform's Part A PR is unmerged, and reporting
    nothing here would recreate the exact silent-disable bug this ticket exists to fix.
    """
    token = token if token is not None else os.environ.get(TOKEN_ENV)
    use_gh = not token and not os.environ.get(GH_FALLBACK_ENV)
    if not token and not use_gh:
        return {}, [
            f"{TOKEN_ENV} is not set, so the semantic-layer anchors could not be read. "
            "Every OKR dormancy check is DISABLED this run."
        ]
    anchors: dict[str, list[Leg]] = {}
    problems: list[str] = []
    for path in SEM_PATHS:
        try:
            text = _fetch_via_gh(path) if use_gh else _fetch(path, token)
        # Wide on purpose, same reasoning as the parse except below: _fetch reads the
        # response body inside urlopen's `with` block, so a connection dropped mid-body
        # raises http.client.IncompleteRead or RemoteDisconnected — neither is a
        # urllib.error.URLError — and either would otherwise escape load_anchors and
        # take the whole digest down over a transient network blip. The gh fallback
        # adds RuntimeError (gh's own nonzero exit) and subprocess.TimeoutExpired
        # (the CLI hanging), same treatment.
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,  # subclass of URLError; named explicitly for readability
            TimeoutError,
            http.client.IncompleteRead,
            http.client.RemoteDisconnected,
            RuntimeError,
            OSError,
            subprocess.TimeoutExpired,
        ) as exc:
            via = "gh api" if use_gh else "the GitHub API"
            problems.append(
                f"could not read {path} from {REPO} via {via} ({exc}). Anchors from this "
                "file are not being watched this run."
            )
            continue
        try:
            anchors.update(parse_anchors(text))
        # Wide on purpose: the input is another repo's YAML, so every shape it can be
        # wrong in — a leg with no event (ValueError), anchored_on that is not a list of
        # mappings (TypeError/AttributeError), or a file that does not parse at all —
        # is the same incident, and none of them may cost omni its digest.
        except (ValueError, TypeError, AttributeError, yaml.YAMLError) as exc:
            problems.append(
                f"{path} in {REPO} has a malformed anchored_on declaration ({exc}). "
                "Anchors from this file are not being watched this run."
            )
    if not anchors and problems and all("could not read" in p for p in problems):
        problems.append("Every OKR dormancy check is DISABLED this run.")
    if not problems and not anchors:
        problems.append(
            f"Read every governed sem file from {REPO} successfully but found no "
            "anchored_on declarations in any of them. Either the declaration has not "
            "merged into main yet, or it was removed from the sem files. Every OKR "
            "dormancy check is DISABLED this run."
        )
    return anchors, problems
