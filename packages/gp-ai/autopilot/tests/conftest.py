"""Loads the conductor Lambda handler module for the tests in this directory.

"lambda" is a Python keyword, so the module cannot be reached with a normal
dotted import (`from autopilot.lambda import handler` is a SyntaxError) — load
it directly from its file path instead, the same way clickup_bot/tests/ does.

Registered under a PRIVATE sys.modules key (not the bare "handler" clickup_bot
uses), because the whole gp-ai suite runs in one pytest process (see the root
Makefile's TEST_PATHS): if this also bound the bare name "handler", whichever
of the two test suites imports first would silently win, and the other
module's tests would exercise the wrong Lambda's code.
"""

import importlib.util
import sys
from pathlib import Path

_MODULE_NAME = "autopilot_conductor_handler"
_HANDLER_PATH = Path(__file__).resolve().parent.parent / "lambda" / "handler.py"

if _MODULE_NAME not in sys.modules:
    _spec = importlib.util.spec_from_file_location(_MODULE_NAME, _HANDLER_PATH)
    assert _spec is not None and _spec.loader is not None
    _module = importlib.util.module_from_spec(_spec)
    sys.modules[_MODULE_NAME] = _module
    _spec.loader.exec_module(_module)
