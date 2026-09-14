import importlib.util
import json
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# The handler is loaded BY PATH under a unique module name, rather than by
# putting its directory on sys.path the way clickup_bot's conftest does.
#
# WHY: both Lambdas ship a file called `handler.py`, because both are configured
# as `handler.handler` and Terraform zips them by name. Two `lambda/`
# directories on sys.path means `import handler` resolves to whichever conftest
# ran first — so `make test`, which runs both suites in one pytest process, had
# clickup_bot's tests importing this filter's handler and failing on attributes
# it does not have. Renaming either file would fix the collision by making the
# deployed artifact's name depend on a test-runner detail, which is the wrong
# thing to be load-bearing.
_HANDLER_PATH = Path(__file__).resolve().parent.parent / "lambda" / "handler.py"
_SPEC = importlib.util.spec_from_file_location("alert_filter_handler", _HANDLER_PATH)
if _SPEC is None or _SPEC.loader is None:
    # Raised rather than skipped: the handler not being loadable means every
    # test below would pass by not running, which is the one outcome worse than
    # a red suite.
    raise ImportError(f"could not load the alert filter handler from {_HANDLER_PATH}")
_HANDLER = importlib.util.module_from_spec(_SPEC)
# Registered under the unique name ONLY, and deliberately not also under the
# bare `handler`. Claiming that name here would fix this suite by breaking
# clickup_bot's in the other direction — its tests do `import handler`, and
# sys.modules is consulted before sys.path, so whichever suite claimed the bare
# name would win regardless of ordering. This suite imports
# `alert_filter_handler` instead.
sys.modules["alert_filter_handler"] = _HANDLER
_SPEC.loader.exec_module(_HANDLER)


class _NoAws(Exception):
    pass


@pytest.fixture(autouse=True)
def no_aws(monkeypatch):
    """Reaching AWS from a test fails loudly and instantly.

    NOT MERELY HYGIENE. Without it, a test that forgets to provide a credential
    falls through to `secret`'s Secrets Manager lookup and waits out botocore's
    connect timeout and retries — which is how this suite went from 0.14s to
    5.4s the moment the bundle lookup was added, with every test still passing.
    A slow green suite is the failure mode here: nobody investigates one, and it
    was hiding the fact that the handler was doing real credential I/O in unit
    tests.

    Each test that legitimately needs a credential sets it in the environment,
    which `secret` checks first.
    """

    def refuse(service, *_, **__):
        raise _NoAws(f"a test reached AWS ({service}); provide the credential in the environment instead")

    monkeypatch.setattr(_HANDLER.boto3, "client", refuse)
    # Reset between tests: a cached bundle from one test would satisfy the next
    # one's lookup and hide exactly the dependency this fixture exists to catch.
    monkeypatch.setattr(_HANDLER, "_secrets", None)
    monkeypatch.setattr(_HANDLER, "_dynamodb", None)


# A real Grafana webhook body, reduced to the keys this filter reads and with
# ids replaced. Captured shape, not invented: the nesting below (per-alert
# labels and annotations under `alerts[]`, group-level copies alongside) is
# where every parsing mistake this filter could make comes from, so the fixture
# has to have it even where a flat dict would make the tests shorter.
@pytest.fixture
def webhook():
    def build(**overrides):
        payload = {
            "status": "firing",
            "groupLabels": {"alertname": "door knocking pack build failed"},
            "commonAnnotations": {},
            "alerts": [
                {
                    "status": "firing",
                    "labels": {
                        "alertname": "[door-knocking] Pack build failed",
                        "alert_slug": "door-knocking-pack-build-failed",
                        "environment": "prod",
                    },
                    "annotations": {
                        "summary": "[PROD] [door-knocking] Pack build failed",
                        "description": (
                            "[PROD] A door-knocking voter map failed to build after the response had "
                            "already started, in the last 10 minutes.\n\n"
                            "Click *View in Grafana* to find the line.\n\n"
                            "<!subteam^S0AE3NTCXM3>"
                        ),
                        "known_causes": json.dumps(
                            [
                                {
                                    "id": "people-db-statement-timeout",
                                    "summary": "A district too large for the current query plan.",
                                    "evidence": '{deployment_environment_name="prod"} |= "PackBuildFailed"',
                                    "confirmedBy": "Every matched line carries `Code: 57014`.",
                                    "action": "suppress",
                                }
                            ]
                        ),
                    },
                    "generatorURL": "https://grafana.example/alerting/grafana/abc/view",
                    "fingerprint": "6f1a2b3c4d5e",
                    "startsAt": "2026-09-14T10:00:00Z",
                }
            ],
        }
        payload.update(overrides)
        return payload

    return build
