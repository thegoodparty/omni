"""What the Lambda deployment artifact has to contain.

Mirrors alert_filter/tests/test_packaging.py's own reasoning exactly: the zip
is assembled in infrastructure/modules/case-scout/main.tf from a fileset
rather than a hand-written list, so these tests check that the glob the
module uses still covers everything the handler imports — a module missing
from the archive is invisible until the Lambda is invoked, which for `start`
is the nightly nothing-waiting-to-retry trigger (GitHub sends it no data), so
the failure would surface as a silent no-op scout rather than a loud one.
"""

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
HANDLER = PACKAGE / "lambda" / "handler.py"

# Restates the two globs in the module's archive_file block. If they change
# there, they must change here too — which is the point: the failure shows up
# as a red test naming the file that stopped shipping.
PACKAGED = {f"case_scout/{p.name}" for p in PACKAGE.glob("*.py")} | {"handler.py"}


def imported_submodules(source: Path) -> set[str]:
    """Every `case_scout.X` this file imports, by either spelling."""
    tree = ast.parse(source.read_text())
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "case_scout":
            found.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and (node.module or "").startswith("case_scout."):
            assert node.module is not None
            found.add(node.module.split(".", 1)[1].split(".")[0])
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name.startswith("case_scout."):
                    found.add(a.name.split(".", 1)[1].split(".")[0])
    return found


class TestTheArchiveCoversWhatTheHandlerNeeds:
    def test_every_module_the_handler_imports_is_packaged(self):
        missing = {m for m in imported_submodules(HANDLER) if f"case_scout/{m}.py" not in PACKAGED}

        assert not missing, f"the handler imports {sorted(missing)}, which the archive would not ship"

    # github_auth imports ai_secrets — a module reachable only through another
    # one is the easiest kind to leave out of an artifact.
    def test_every_module_the_pure_modules_import_is_packaged(self):
        missing = set()
        for module in PACKAGE.glob("*.py"):
            missing |= {m for m in imported_submodules(module) if f"case_scout/{m}.py" not in PACKAGED}

        assert not missing, f"a packaged module imports {sorted(missing)}, which the archive would not ship"

    def test_the_package_marker_ships(self):
        assert "case_scout/__init__.py" in PACKAGED

    def test_the_handler_is_at_the_archive_root_under_the_name_lambda_calls(self):
        assert "handler.py" in PACKAGED
        assert HANDLER.exists()


class TestWhatMustNotShip:
    # The `*.py` glob is top-level only, which is what keeps tests/, lambda/
    # and reader/ out without an exclude list.
    def test_the_tests_are_not_in_the_artifact(self):
        assert not any(p.startswith("case_scout/tests") for p in PACKAGED)

    def test_the_reader_is_not_in_the_lambda_artifact(self):
        # The Reader runs as its own Fargate container image, built from the
        # same case_scout source but via case_scout/Dockerfile, not this zip.
        assert not any(p.startswith("case_scout/reader") for p in PACKAGED)

    def test_the_handler_source_is_not_shipped_twice(self):
        assert "case_scout/lambda" not in PACKAGED
        assert not any(p.startswith("case_scout/lambda") for p in PACKAGED)
