"""What the deployment artifact has to contain.

The Lambda zip is assembled in infrastructure/modules/alert-filter/main.tf from
a fileset rather than a hand-written list, precisely so that adding a module
packages it automatically. These tests are the other half of that: they check
that the glob the module uses still covers everything the handler imports, and
that nothing which must not ship is caught by it.

WHY THIS IS A TEST AND NOT A CODE REVIEW HABIT: a module missing from the
archive is invisible until the function is invoked, and the function is invoked
when an alert fires. The cost of finding out late is paid during an incident,
while looking at an alerting system that has itself stopped working.
"""

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
HANDLER = PACKAGE / "lambda" / "handler.py"

# The two globs in the module's archive_file block, restated. If they change
# there, they must change here — which is the point: the failure shows up as a
# red test naming the file that stopped shipping.
PACKAGED = {f"alert_filter/{p.name}" for p in PACKAGE.glob("*.py")} | {"handler.py"}


def imported_submodules(source: Path) -> set[str]:
    """Every `alert_filter.X` this file imports, by either spelling."""
    tree = ast.parse(source.read_text())
    found: set[str] = set()
    for node in ast.walk(tree):
        # from alert_filter import classify, render
        if isinstance(node, ast.ImportFrom) and node.module == "alert_filter":
            found.update(a.name for a in node.names)
        # from alert_filter.classify import SUPPRESS
        elif isinstance(node, ast.ImportFrom) and (node.module or "").startswith("alert_filter."):
            assert node.module is not None
            found.add(node.module.split(".", 1)[1].split(".")[0])
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name.startswith("alert_filter."):
                    found.add(a.name.split(".", 1)[1].split(".")[0])
    return found


class TestTheArchiveCoversWhatTheHandlerNeeds:
    def test_every_module_the_handler_imports_is_packaged(self):
        missing = {m for m in imported_submodules(HANDLER) if f"alert_filter/{m}.py" not in PACKAGED}

        assert not missing, f"the handler imports {sorted(missing)}, which the archive would not ship"

    # The pure modules import each other — classify is used by render's callers,
    # metrics reads classify's outcomes — and a module reachable only through
    # another one is the easiest kind to leave out of an artifact.
    def test_every_module_the_pure_modules_import_is_packaged(self):
        missing = set()
        for module in PACKAGE.glob("*.py"):
            missing |= {m for m in imported_submodules(module) if f"alert_filter/{m}.py" not in PACKAGED}

        assert not missing, f"a packaged module imports {sorted(missing)}, which the archive would not ship"

    # Lambda puts the archive root on sys.path, so `from alert_filter import ...`
    # only resolves if the package marker rides along. Without it the handler
    # raises ModuleNotFoundError on its first invocation.
    def test_the_package_marker_ships(self):
        assert "alert_filter/__init__.py" in PACKAGED

    def test_the_handler_is_at_the_archive_root_under_the_name_lambda_calls(self):
        # The module sets handler = "handler.handler", which means a file named
        # handler.py at the root, not alert_filter/lambda/handler.py.
        assert "handler.py" in PACKAGED
        assert HANDLER.exists()


class TestWhatMustNotShip:
    # The `*.py` glob is top-level only, which is what keeps tests/ out without
    # an exclude list. If someone widens it to `**/*.py` to catch a module in a
    # subdirectory, this fails rather than silently shipping the test suite —
    # and with it, the fixtures that contain fake tokens.
    def test_the_tests_are_not_in_the_artifact(self):
        assert not any(p.startswith("alert_filter/tests") for p in PACKAGED)

    def test_the_handler_source_is_not_shipped_twice(self):
        # alert_filter/lambda/handler.py must arrive as handler.py only. Shipped
        # at both paths, an edit to one copy would appear to do nothing.
        assert "alert_filter/lambda" not in PACKAGED
        assert not any(p.startswith("alert_filter/lambda") for p in PACKAGED)
