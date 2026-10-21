"""Read governed metric anchors from gp-data-platform's semantic layer (DATA-2421).

The semantic layer is the kernel. This monitor derives what to watch from the
metric's own `config.meta.anchored_on` rather than a hand-maintained list here,
because a hand-maintained copy is exactly what went stale and let a broken OKR
metric run quiet for a month.

Cross-repo read. CI holds a read token; a human running the monitor without one
falls back to their own `gh` auth instead. Only when both are unavailable do the
anchored checks disable themselves. The rest of the monitor runs unchanged: the
weekly digest is more valuable degraded than not posted at all.
"""

from __future__ import annotations

import http.client
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from pathlib import Path

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
VENDORED_DIR = Path(__file__).resolve().parent / "instrumentation_data" / "sem"
_REFRESHED = re.compile(r"^# Refreshed from \S+ on (\d{4}-\d{2}-\d{2})", re.M)


def _freeze_excluding(raw: object) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """Normalise `excluding` to a sorted, hashable shape. A declared value may be one
    string or a list of them, matching what the dbt macro compiles."""
    if not raw:
        return ()
    frozen = []
    for prop, value in sorted(dict(raw).items()):  # type: ignore[call-overload]
        values = value if isinstance(value, (list, tuple)) else [value]
        # Values sorted too, not just the property names: the excluded values
        # are a set, and a YAML reorder that means the same thing must not read
        # as a different instrument with its own series and its own history.
        frozen.append((str(prop), tuple(sorted(str(v) for v in values))))
    return tuple(frozen)


@dataclass(frozen=True)
class Leg:
    """One raw signal that feeds a governed metric."""

    event: str
    path: str | None = None
    era: str | None = None
    excluding: tuple[tuple[str, tuple[str, ...]], ...] = ()

    @property
    def key(self) -> str:
        """Series key. A qualified leg needs its own: 'Viewed' is site-wide at 4.46M
        rows and only its '/dashboard' slice is the instrument, and 'Voter Outreach -
        Campaign Completed' covers three moments of which the metric counts two. Watching
        the bare event in either case watches something wider than the metric counts."""
        quals = [f"path={self.path}"] if self.path else []
        quals += [f"excluding {prop}={','.join(values)}" for prop, values in self.excluding]
        return f"{self.event}[{', '.join(quals)}]" if quals else self.event

    @property
    def qualified(self) -> bool:
        """True when the leg is narrower than its event, so Amplitude's catalog has no
        record for it and its own weekly rows are the only honest source."""
        return bool(self.path or self.excluding)

    @property
    def registry_key(self) -> str:
        """The key a behavior-registry surface names this leg under.

        A path slice is its own instrument, so the registry names the slice. An exclusion
        is a scope rule the metric applies over one event, not a different call site, so
        the registry names the bare event and the two must still compare equal.
        """
        return f"{self.event}[path={self.path}]" if self.path else self.event

    @property
    def watched(self) -> bool:
        """Historical legs are kept so old numbers stay right, but they are not
        expected to fire, so watching them would alarm forever."""
        return self.era != "historical"


def is_qualified_key(key: str) -> bool:
    """Whether a series key names a slice of an event rather than a whole event.

    String-level because the alignment checks are handed registry surface keys, which
    are strings with no Leg behind them.
    """
    return "[path=" in key or "[excluding " in key


def parse_anchors(text: str) -> dict[str, list[Leg]]:
    """Parse a sem YAML into ``{metric_name: [Leg, ...]}`` for metrics declaring one.

    Every qualifier the declaration carries is kept. A parser that drops one reports a
    leg as wider than the metric actually counts, which is the monitor watching the
    wrong thing while reading green.
    """
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
            legs.append(
                Leg(
                    event=event,
                    path=leg.get("path"),
                    era=leg.get("era"),
                    excluding=_freeze_excluding(leg.get("excluding")),
                )
            )
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
            f"{TOKEN_ENV} is not set and {GH_FALLBACK_ENV} is set, so neither the "
            "token nor the gh CLI fallback is available. Every OKR dormancy check is "
            "DISABLED this run."
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


def refresh_vendored(directory: Path = VENDORED_DIR, token: str | None = None,
                     today: str | None = None) -> list[str]:
    """Rewrite the committed copy of each governed sem file from gp-data-platform main.

    The pre-merge guard reads only this copy, so a network failure can never stop a merge.
    A file that fails to read, fails to parse, or declares no anchors keeps its previous
    copy: a stale definition still guards, an empty one would silently guard nothing.
    """
    token = token if token is not None else os.environ.get(TOKEN_ENV)
    today = today or date.today().isoformat()
    directory.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    for path in SEM_PATHS:
        name = path.rsplit("/", 1)[-1]
        try:
            text = _fetch(path, token) if token else _fetch_via_gh(path)
        except (urllib.error.URLError, TimeoutError, http.client.IncompleteRead,
                http.client.RemoteDisconnected, RuntimeError, OSError,
                subprocess.TimeoutExpired) as exc:
            problems.append(f"could not read {path}: {exc}; kept the previous copy of {name}")
            continue
        try:
            anchors = parse_anchors(text)
        except (ValueError, TypeError, AttributeError, yaml.YAMLError) as exc:
            problems.append(f"{path} is malformed ({exc}); kept the previous copy of {name}")
            continue
        if not anchors:
            problems.append(f"{path} has no anchored_on declarations; kept the previous copy of {name}")
            continue
        header = (f"# Refreshed from {REPO} on {today} by sem_anchors.py refresh-vendored.\n"
                  "# Do not edit by hand: the analytics-governance run rewrites it every Monday and Thursday.\n")
        (directory / name).write_text(header + text)
    return problems


VENDORED_NAMES = tuple(path.rsplit("/", 1)[-1] for path in SEM_PATHS)


def parse_vendored_texts(texts: Iterable[str]) -> tuple[dict[str, list[Leg]], str | None]:
    """Anchors across vendored copies, plus the oldest refresh date among them."""
    anchors: dict[str, list[Leg]] = {}
    dates: list[str] = []
    for text in texts:
        anchors.update(parse_anchors(text))
        if m := _REFRESHED.search(text):
            dates.append(m.group(1))
    return anchors, (min(dates) if dates else None)


def load_vendored_anchors(directory: Path = VENDORED_DIR) -> tuple[dict[str, list[Leg]], str | None]:
    files = [directory / name for name in VENDORED_NAMES]
    return parse_vendored_texts(f.read_text() for f in files if f.exists())


def load_metric_labels(token: str | None = None) -> dict[str, str]:
    """``{metric_name: label}`` across the governed sem files, for display only.

    Best effort, unlike ``load_anchors``: a missing label costs a page its readable name
    and nothing else, so a failed read returns what it has and the page shows the id.
    """
    token = token if token is not None else os.environ.get(TOKEN_ENV)
    use_gh = not token and not os.environ.get(GH_FALLBACK_ENV)
    if not token and not use_gh:
        return {}
    labels: dict[str, str] = {}
    for path in SEM_PATHS:
        try:
            text = _fetch_via_gh(path) if use_gh else _fetch(path, token)
            for metric in (yaml.safe_load(text) or {}).get("metrics") or []:
                if metric.get("name") and metric.get("label"):
                    labels[metric["name"]] = str(metric["label"])
        except Exception:  # noqa: BLE001 - display-only; see docstring
            continue
    return labels


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["refresh-vendored"])
    parser.parse_args(argv)
    problems = refresh_vendored()
    for p in problems:
        print(p, file=sys.stderr)
    return 1 if len(problems) == len(SEM_PATHS) else 0


if __name__ == "__main__":
    raise SystemExit(main())
