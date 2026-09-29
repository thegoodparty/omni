"""Feed the gotchas book into the governance judges' prompts (DATA-2575).

Both judges in the scheduled run — the gap judge in ``instrumentation_gaps.py`` and the
digest tier judge in ``digest_triage.py`` — are a SINGLE forced-tool-call API request with
a fixed ``system`` string. No tools, no filesystem, no agentic loop. So an instruction like
"read the gotchas book" is one the judge physically cannot follow: the only thing it ever
sees is text already pasted into that string. The book's text has to be concatenated in,
which is what this module does.

It matters because both judges rule BEFORE any human sees the digest. A judge that does not
know "zero call sites while firing normally is our blind counter, not a dead event" will
confidently confirm a gap or tier a finding red on a premise the book already refutes, and
the human then triages a verdict that was wrong upstream.

Never raises. A missing or corrupt book degrades to an empty string and the judge runs on
its rubric alone, because both callers hold a never-raise contract — the governance run must
not fail over documentation. Empty in, empty out: no header is emitted with no body under it.

Read-only in both directions. Nothing here writes the book; updates to it happen only with a
human in the loop (the `triage-instrumentation-gaps` review), never from a scheduled run.
"""

from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]  # python -> scripts -> runbooks -> packages -> omni
DEFAULT_GOTCHAS_PATH = REPO_ROOT / "packages/runbooks/books/analytics-governance-gotchas.md"

_HEADER = (
    "# Known gotchas in this governance process\n\n"
    "Each row is a signal that has already produced a confident, wrong verdict. Before "
    "ruling on an item, check whether one of these explains what you are seeing — a row "
    "that applies outranks the inference you would otherwise draw from the same evidence. "
    "Rows marked `state · as-of <date>` are facts with a shelf life: treat them as likely "
    "but re-checkable, and weigh them less the older the date. Rows marked `invariant` do "
    "not drift."
)


START_MARKER = "<!-- judge-input:start -->"
END_MARKER = "<!-- judge-input:end -->"


def judge_input_section(text: str) -> str:
    """The slice of the book between the judge-input markers.

    The book carries two tables. Only the judgment traps — rows that change a verdict
    someone is about to reach — belong in a prompt. The rest are tooling defects awaiting
    a Python fix and process rules about git archaeology and systems of record: real
    knowledge, but nothing a judge can act on, so paying prompt weight for it twice a week
    buys nothing.

    Missing markers fall back to the WHOLE file, deliberately. The two failure directions
    are not symmetric: a marker typo that sends slightly too much context costs tokens,
    while one that sends nothing silently blinds both judges to every trap. A test asserts
    the committed book has both markers, so a typo fails CI rather than either.
    """
    start = text.find(START_MARKER)
    end = text.find(END_MARKER)
    if start == -1 or end == -1 or end < start:
        return text
    return text[start + len(START_MARKER):end].strip()


def load_gotchas(path: Path | None = None) -> str:
    """The book's judge-input section, or ``""`` if the file cannot be read.

    The default is resolved at call time, not bound as a default argument: callers invoke
    this with no argument, so a definition-time binding would make the path impossible to
    redirect and the degraded path impossible to test.

    ``ValueError`` covers ``UnicodeDecodeError`` (a subclass) on a mis-encoded file, the
    same way ``digest_triage.run_triage`` guards its own rubric read.
    """
    try:
        text = (path or DEFAULT_GOTCHAS_PATH).read_text()
    except (OSError, ValueError):
        return ""
    return judge_input_section(text)


def gotchas_prompt_section(text: str) -> str:
    """Wrap the book for a judge's system prompt, named so the judge knows what it is."""
    if not text.strip():
        return ""
    return f"{_HEADER}\n\n{text}"
