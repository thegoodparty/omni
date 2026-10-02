"""Where each webapp analytics event can fire, from the code alone (DATA-2531).

Pure over the guard's Snapshot: no git, no network. The PR guard and the weekly surface
drift detector both import it, so the two cannot disagree about where an event fires.
An event's area comes from productMap.ts first (the nav's own words), then from its
page's title, which is what a person sees on a page that has no nav entry.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

APP = "packages/gp-webapp/app/"
WEB = "packages/gp-webapp/"
PRODUCT_MAP = "packages/gp-api/src/chats/general/product-knowledge/productMap.ts"

_PAGE_STEMS = frozenset({"page"})
_LAYOUT_STEMS = frozenset({"layout", "template"})
_OTHER_STEMS = frozenset({"error", "loading", "not-found", "default", "global-error"})
_MAP_ENTRY = re.compile(r"""name:\s*'([^']+)',\s*\n\s*path:\s*'(/[^']*)'""")
_TITLE = re.compile(r"""\btitle:\s*(['"`])(.*?)\1""", re.S)
_REDIRECT = re.compile(r"\b(?:redirect|permanentRedirect)\s*\(")
# JSX is a `<Tag` right after `return` or an arrow. A bare `<` would also match the
# return type `Promise<React.JSX.Element>` and call every redirect page live.
_JSX = re.compile(r"(?:\breturn|=>)\s*\(?\s*<[A-Za-z]")
_IMPORT_LINE = re.compile(r"^\s*import\b[^\n]*\n", re.M)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _stem(path: str) -> str:
    return path.rsplit("/", 1)[-1].rsplit(".", 1)[0]


def route_kind(path: str) -> str | None:
    if not path.startswith(APP):
        return None
    stem = _stem(path)
    if stem in _PAGE_STEMS:
        return "page"
    if stem in _LAYOUT_STEMS:
        return "layout"
    if stem in _OTHER_STEMS:
        return "other"
    if stem == "route":
        return "api"
    return None


def route_of(path: str) -> str:
    parts = path[len(APP):].split("/")[:-1]
    segs = [p for p in parts if not (p.startswith("(") and p.endswith(")")) and not p.startswith("@")]
    return "/" + "/".join(segs)


def is_bare_redirect(text: str) -> bool:
    body = _IMPORT_LINE.sub("", text)
    return bool(_REDIRECT.search(body)) and not _JSX.search(body)


def page_title(text: str) -> str | None:
    m = _TITLE.search(text)
    if not m:
        return None
    raw = m.group(2)
    if "${" in raw:
        return None
    title = raw.split("|")[0].strip()
    if not title or title.lower() == "goodparty.org":
        return None
    return title


@dataclass(frozen=True)
class Area:
    key: str
    label: str
    names: frozenset[str]


def _route_regex(route: str) -> re.Pattern[str]:
    parts = []
    for seg in route.split("/"):
        if seg.startswith("[[...") or seg.startswith("[..."):
            parts.append(".+")
        elif seg.startswith("["):
            parts.append("[^/]+")
        else:
            parts.append(re.escape(seg))
    return re.compile("^" + "/".join(parts) + "$")


class AreaIndex:
    def __init__(self, product_map_text: str, page_texts: Mapping[str, str]):
        self.product: dict[str, Area] = {}
        for name, path in _MAP_ENTRY.findall(product_map_text):
            prev = self.product.get(path)
            names = {slug(name)} | (set(prev.names) if prev else set())
            self.product[path] = Area(path, prev.label if prev else name, frozenset(names))
        self._by_length = sorted(self.product, key=len, reverse=True)
        self.titles = {r: t for r, text in page_texts.items() if (t := page_title(text))}
        self.page_routes = sorted(page_texts)
        self._patterns = [(r, _route_regex(r)) for r in self.page_routes]

    def area(self, route: str) -> Area:
        if route in self.product:
            return self.product[route]
        for path in self._by_length:
            # Only a specific area claims its subroutes. '/dashboard' is the Campaign
            # Manager home; letting it claim every unmapped dashboard page would file
            # Additional Questions and Election Result under it.
            if path.count("/") >= 2 and route.startswith(path + "/"):
                return self.product[path]
        r = route
        while True:
            if r in self.titles:
                return Area(r, self.titles[r], frozenset({slug(self.titles[r])}))
            if r == "/":
                break
            r = r.rsplit("/", 1)[0] or "/"
        # The last literal segment names the page; the first is usually just "dashboard".
        seg = next((s for s in reversed(route.split("/")) if s and not s.startswith("[")), "root")
        return Area(route, seg, frozenset({slug(seg)}))

    def area_for_path(self, url_path: str) -> Area | None:
        path = url_path.split("?")[0].split("#")[0].rstrip("/") or "/"
        best: tuple[int, str] | None = None
        for route, pattern in self._patterns:
            if pattern.match(path):
                literal = sum(1 for s in route.split("/") if s and not s.startswith("["))
                if best is None or literal > best[0]:
                    best = (literal, route)
        return self.area(best[1]) if best else None

    def all_areas(self) -> list[Area]:
        found = {a.key: a for a in self.product.values()}
        for route in self.page_routes:
            a = self.area(route)
            found.setdefault(a.key, a)
        return sorted(found.values(), key=lambda a: a.key)
