"""Relative-import resolution over the TypeScript sources (DATA-2539).

Pure: everything takes text or repo-relative paths plus an injected `exists` predicate, so
the module unit-tests with fixtures and never touches disk.

Shared deliberately. instrumentation_gaps.py uses the forward edge to tell its judge that a
surface's logic may live in a hook; DATA-2531 needs the reverse edge to answer whether a
component's own route is still live or whether it is mounted from somewhere else. Two
resolvers would drift, and the second one would be written in a hurry.
"""

from __future__ import annotations

import posixpath
import re
from collections.abc import Callable, Mapping

# The `(?:\w+\s*,\s*)?` arm matters: in `import Default, { useHook } from './x'` the named
# block does not follow `import` directly, and without it _DEFAULT_IMPORT_RE swallows the
# whole statement and `useHook` is never returned — so a surface whose handler lives in a
# hook imported that way reads as uninstrumented and false-alarms.
_NAMED_IMPORT_RE = re.compile(
    r"""import\s+(?:type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]"""
)
_DEFAULT_IMPORT_RE = re.compile(
    r"""import\s+(?:type\s+)?(\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"](\.[^'"]+)['"]"""
)
# The suffix ladder a bundler walks for an extensionless specifier.
_RESOLUTION_SUFFIXES = (".ts", ".tsx", "/index.ts", "/index.tsx")
_HOOK_RE = re.compile(r"^use[A-Z]")


def parse_relative_imports(text: str) -> list[tuple[str, str]]:
    """[(local_name, module_spec)] for each relative import that binds a name.

    A bare `import './x'` is skipped: nothing can reference it, so it can carry no signal
    about where a surface's logic lives."""
    out: list[tuple[str, str]] = []
    for names, spec in _NAMED_IMPORT_RE.findall(text):
        for raw in names.split(","):
            # `a as b` binds b, which is the name a caller would actually reference.
            name = raw.strip().split(" as ")[-1].strip()
            if name:
                out.append((name, spec))
    for name, spec in _DEFAULT_IMPORT_RE.findall(text):
        out.append((name, spec))
    return out


def resolve_import(
    from_rel_path: str, spec: str, exists: Callable[[str], bool]
) -> str | None:
    """Resolve one relative spec against the importing file. Repo-relative posix path, or
    None when nothing on the suffix ladder exists.

    A spec that normalizes above the repo root returns None rather than being probed: the
    sweep only ever reasons about files inside the tree it walked."""
    base = posixpath.normpath(posixpath.join(posixpath.dirname(from_rel_path), spec))
    if base.startswith(".."):
        return None
    if base.endswith((".ts", ".tsx")) and exists(base):
        return base
    for suffix in _RESOLUTION_SUFFIXES:
        candidate = base + suffix
        if exists(candidate):
            return candidate
    return None


def is_hook_name(name: str) -> bool:
    """React hook naming convention: `use` followed by an uppercase letter. `useless` is a
    variable, `useThing` is a hook."""
    return bool(_HOOK_RE.match(name))


def build_reverse_index(
    texts: Mapping[str, str], exists: Callable[[str], bool]
) -> dict[str, list[str]]:
    """{imported_file: sorted importers}. The reverse edge DATA-2531 needs for reachability.

    Unused by the gap sweep itself. Kept here because it is four lines given the parser and
    because writing it now is what makes this module shared rather than a thing DATA-2531
    reimplements. If that ticket is dropped, delete this function."""
    out: dict[str, set[str]] = {}
    for rel, text in texts.items():
        for _name, spec in parse_relative_imports(text):
            target = resolve_import(rel, spec, exists)
            if target is not None:
                out.setdefault(target, set()).add(rel)
    return {k: sorted(v) for k, v in out.items()}
