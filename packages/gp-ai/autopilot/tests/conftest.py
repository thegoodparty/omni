"""Loads the conductor Lambda's lambda/ modules for the tests in this
directory.

"lambda" is a Python keyword, so none of these can be reached with a normal
dotted import (`from autopilot.lambda import handler` is a SyntaxError) — load
each directly from its file path instead, the same way clickup_bot/tests/
does for its single handler.py.

Registered under PRIVATE sys.modules keys (not the bare "handler" clickup_bot
uses), because the whole gp-ai suite runs in one pytest process (see the root
Makefile's TEST_PATHS): if this also bound bare names, whichever test suite
imports first would silently win, and the other module's tests would
exercise the wrong Lambda's code.

router.py and dispatch.py are loaded BEFORE handler.py: handler.py's own
sibling-module loader (see its _load_sibling_module) checks sys.modules
under these exact names first, so it reuses the modules set up here instead
of re-executing them — meaning a test's monkeypatch on, say, `dispatch.
get_dynamodb_client` is monkeypatching the very module object handler.py's
route_event calls into.
"""

import importlib.util
import sys
from pathlib import Path

_LAMBDA_DIR = Path(__file__).resolve().parent.parent / "lambda"


def _load(stem: str, module_name: str) -> None:
    if module_name in sys.modules:
        return
    spec = importlib.util.spec_from_file_location(module_name, _LAMBDA_DIR / f"{stem}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)


_load("router", "autopilot_conductor_router")
_load("dispatch", "autopilot_conductor_dispatch")
_load("handler", "autopilot_conductor_handler")
# Loaded by handler.py itself as a side effect of the line above (see the
# comment at the bottom of handler.py) — these two calls are then no-ops that
# just register the names explicitly, the same way router/dispatch are above.
_load("supervisor", "autopilot_conductor_supervisor")
_load("sweep", "autopilot_conductor_sweep")
