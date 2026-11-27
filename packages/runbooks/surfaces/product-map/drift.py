"""The drift guard: does each drawn flow on the map still match the steps in its code?

Every drawing in `map.js` is hand-written, so a flow that gains or loses a step in code
keeps its old drawing and nothing says so. `sources.json` records, per drawn surface,
the files its steps were read from and, where the code declares its steps as a list,
how to read that list. `build.py` runs `check_all` and hands the result to the page,
which marks a surface whose drawing no longer matches as "changed since drawn".

Three levels, weakest last, and the page says which one each surface has:

- `list`: the code declares its steps (an array, a union type, an enum). The whole
  declared set is compared with the drawn set, so a step added in code is caught as
  well as one removed.
- `ids`: no declared list. Each drawn step id (or its `aliases`) must still appear as
  a whole token in a source file. A step added in code cannot be seen this way.
- `none`: nothing in the code names the steps (a page's zones, numbered steps). Only
  the files are checked.

Drift marks the page and never fails the build or the runbooks tests: the person who
changes a flow is not the person who maintains its drawing, so a red check would land
on the wrong desk. A malformed `sources.json` entry does raise, because that is the
map's own author getting the guard wrong; a missing one only shows as unchecked, and
the runbooks tests fail on it.

Dependency-free, like `build.py`: the republish routine runs it with a bare interpreter.
"""
import re
from pathlib import Path

LEVELS = ("list", "ids", "none")
_UNCHECKED = {
    "level": "none",
    "files": [],
    "missing_files": [],
    "added": [],
    "removed": [],
    "unreadable": [],
    "changed": False,
}
_KEYS = {"files", "lists", "aliases", "not_drawn", "not_declared", "unchecked"}
_QUOTED = r"'([^'\\]+)'"


def drawn_steps(map_js: str) -> dict[str, list[str]]:
    """Each drawn surface's name and step ids, read from the surface constants in map.js.

    A step drawn with a helper (`shellStep('purpose', ...)`) counts the same as one
    written out (`id: 'purpose'`).
    """
    surfaces = {}
    for block in re.findall(r"^  const [A-Z_]+ = \{\n(.*?)^  \}\n", map_js, re.S | re.M):
        name = re.search(rf"^    name: {_QUOTED},$", block, re.M)
        if not name or not re.search(r"^    kind: '(flow|page)',$", block, re.M):
            continue
        ids = re.findall(rf"\bid: {_QUOTED}", block) + re.findall(
            rf"\bshellStep\({_QUOTED}", block
        )
        surfaces[name.group(1)] = ids
    return surfaces


def declared_steps(root: Path, spec: dict) -> set[str]:
    """The step ids a source file declares, read between two literal markers.

    `take` is a regex with one group, applied to the text between `from` and `to`; it
    defaults to every single-quoted string. Raises when a marker is gone, since an empty
    read would report every drawn step as removed for the wrong reason.
    """
    text = (root / spec["file"]).read_text()
    start = text.find(spec["from"])
    if start < 0:
        raise LookupError(f"{spec['file']}: no {spec['from']!r}")
    start += len(spec["from"])
    end = text.find(spec["to"], start)
    if end < 0:
        raise LookupError(f"{spec['file']}: no {spec['to']!r} after {spec['from']!r}")
    found = set(re.findall(spec.get("take", _QUOTED), text[start:end]))
    if not found:
        raise LookupError(f"{spec['file']}: read no steps after {spec['from']!r}")
    return found


def _validate(name: str, spec: dict) -> None:
    unknown = set(spec) - _KEYS
    if unknown:
        raise ValueError(f"sources.json {name!r}: unknown keys {sorted(unknown)}")
    if not spec.get("files"):
        raise ValueError(f"sources.json {name!r}: no files")
    if spec.get("lists") and spec.get("unchecked"):
        raise ValueError(f"sources.json {name!r}: has lists and is unchecked")


def check(root: Path, name: str, spec: dict, drawn: list[str]) -> dict:
    """One surface's result: its level and whatever no longer matches.

    `changed` is true when a source file is gone, a declared list cannot be read, or the
    steps disagree. Ids are compared as sets; the guard notices a step appearing or
    disappearing, not a reorder.
    """
    _validate(name, spec)
    aliases = spec.get("aliases", {})
    code_ids = {c for d in drawn for c in aliases.get(d, [d])}
    missing_files = [f for f in spec["files"] if not (root / f).exists()]
    result = {
        "level": "none" if spec.get("unchecked") else "list" if spec.get("lists") else "ids",
        "files": spec["files"],
        "missing_files": missing_files,
        "added": [],
        "removed": [],
        "unreadable": [],
        "why_unchecked": spec.get("unchecked", ""),
    }
    if result["level"] == "list":
        declared = set()
        for lst in spec["lists"]:
            try:
                declared |= declared_steps(root, lst)
            except (OSError, LookupError) as err:
                result["unreadable"].append(str(err))
        if not result["unreadable"]:
            expected = declared - set(spec.get("not_drawn", {}))
            result["added"] = sorted(expected - code_ids)
            result["removed"] = sorted(code_ids - declared - set(spec.get("not_declared", {})))
    elif result["level"] == "ids":
        texts = "\n".join(
            (root / f).read_text() for f in spec["files"] if (root / f).is_file()
        )
        # A whole token, not a quoted string: route steps are path segments in template
        # literals (`${id}/expand-review`), and `-` counts as part of the token so
        # expand-payment is not found inside expand-payment-success.
        result["removed"] = sorted(
            c for c in code_ids if not re.search(rf"(?<![\w-]){re.escape(c)}(?![\w-])", texts)
        )
    result["changed"] = bool(
        missing_files or result["unreadable"] or result["added"] or result["removed"]
    )
    return result


def check_all(root: Path, sources: dict, map_js: str) -> dict[str, dict]:
    """Every drawn surface's result, keyed by surface name.

    A drawn surface with no entry shows as unchecked rather than raising: the republish
    routine runs this build, and the map should still publish. The runbooks tests are
    what fail on a missing or orphaned entry.
    """
    # A wrong root would report every source file missing and mark every flow changed,
    # which reads as the product moving rather than the build being misconfigured.
    if not (root / "packages/gp-webapp").is_dir():
        raise FileNotFoundError(f"{root}: not the repo root (no packages/gp-webapp)")
    drawn = drawn_steps(map_js)
    if len(drawn) < 10:
        raise ValueError(f"map.js: only {len(drawn)} drawn surfaces read; the parser has drifted")
    return {
        name: check(root, name, sources[name], ids)
        if name in sources
        else {**_UNCHECKED, "why_unchecked": "this drawing has no entry in sources.json yet"}
        for name, ids in drawn.items()
    }
