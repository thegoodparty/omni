"""The three published surfaces build from one set of shared partials (DATA-2580).

Each build is a bare-interpreter script, so these run them as subprocesses the way the
republish routines do, and then check the one thing sharing is for: the card that opens
on every page is the same card.
"""
import re
import subprocess
import sys
from pathlib import Path

import pytest

PACKAGES = Path(__file__).resolve().parents[3]
SURFACES = PACKAGES / "runbooks/surfaces"

BUILDS = {
    "console": (
        SURFACES / "governance-console/build.py",
        SURFACES / "governance-console/governance-console.html",
    ),
    "map": (
        SURFACES / "product-map/build.py",
        SURFACES / "product-map/product-map.html",
    ),
    "explorer": (
        PACKAGES / "prototypes/app/p/analytics-event-explorer/standalone/build.py",
        PACKAGES / "prototypes/app/p/analytics-event-explorer/standalone/analytics-event-explorer.html",
    ),
}

# What the shared card promises on every page: both names, always, and the verdict.
CARD_SENTENCES = (
    "Display name · a label, changeable",
    "Event type · the identifier, fixed",
    "times in the last 30 days, most recently",
)


@pytest.fixture(scope="module")
def built():
    pages = {}
    for name, (script, out) in BUILDS.items():
        run = subprocess.run(
            [sys.executable, str(script)], capture_output=True, text=True, cwd=script.parent
        )
        assert run.returncode == 0, f"{name} build failed:\n{run.stdout}\n{run.stderr}"
        pages[name] = out.read_text()
    return pages


@pytest.mark.parametrize("name", list(BUILDS))
def test_every_placeholder_is_filled(built, name):
    assert not re.findall(r"__[A-Z][A-Z_]+__", built[name])


@pytest.mark.parametrize("name", ["console", "map"])
def test_the_shared_card_is_on_the_page(built, name):
    for sentence in CARD_SENTENCES:
        assert sentence in built[name], f"{name} is missing: {sentence}"


def test_the_shared_card_is_one_file():
    card = (SURFACES / "shared/card.js").read_text()
    for sentence in CARD_SENTENCES:
        assert sentence in card


def test_pages_link_to_each_other(built):
    sys.path.insert(0, str(SURFACES / "shared"))
    from partials import LINKS

    explorer, map_, console = LINKS["__EXPLORER_URL__"], LINKS["__MAP_URL__"], LINKS["__CONSOLE_URL__"]
    assert map_ in built["explorer"] and console in built["explorer"]
    assert explorer in built["map"] and console in built["map"]
    assert explorer in built["console"] and map_ in built["console"]


def test_inline_refuses_an_unfilled_placeholder():
    sys.path.insert(0, str(SURFACES / "shared"))
    from partials import inline

    with pytest.raises(SystemExit, match="__NOT_A_PARTIAL__"):
        inline("<style>/* __THEME_CSS__ */</style> __NOT_A_PARTIAL__ __DATA__")
