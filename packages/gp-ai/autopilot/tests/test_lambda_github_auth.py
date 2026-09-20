"""Unit tests for the conductor Lambda's stdlib-only GitHub App auth
(lambda/github_auth.py) — see that module's docstring for why it hand-rolls
RS256 signing instead of importing pyjwt/cryptography (the Lambda's zip ships
no pip-installed dependencies beyond boto3/botocore).

Not named test_autopilot_github_auth.py: that file already covers the
Fargate agent's own copy (agent/github_auth.py) — a distinct module with the
same name pattern, kept apart so a failure in one never gets mistaken for the
other.
"""

import json
import time

import autopilot_conductor_github_auth as github_auth
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


@pytest.fixture
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_key, pem, public_pem


@pytest.fixture(autouse=True)
def reset_token_cache():
    github_auth._cached_token = None
    yield
    github_auth._cached_token = None


# ---------------------------------------------------------------------------
# DER parsing
# ---------------------------------------------------------------------------


def test_load_private_key_recovers_the_real_modulus_and_exponent(rsa_keypair):
    private_key, pem, _ = rsa_keypair
    numbers = private_key.private_numbers()

    n, d = github_auth._load_private_key(pem)

    assert n == numbers.public_numbers.n
    assert d == numbers.d


# ---------------------------------------------------------------------------
# RS256 signing — verified against an independent implementation (PyJWT)
# ---------------------------------------------------------------------------


def test_build_app_jwt_produces_a_signature_pyjwt_can_verify(rsa_keypair):
    _, pem, public_pem = rsa_keypair
    n, d = github_auth._load_private_key(pem)

    token = github_auth._build_app_jwt("12345", n, d)

    decoded = pyjwt.decode(token, public_pem, algorithms=["RS256"])
    assert decoded["iss"] == "12345"
    assert decoded["exp"] - decoded["iat"] == 600


def test_build_app_jwt_matches_pyjwts_own_output_byte_for_byte(monkeypatch, rsa_keypair):
    # PKCS#1 v1.5 is deterministic (no randomness in the padding, unlike
    # encryption) — two correct RS256 implementations signing the exact same
    # header+payload with the exact same key must produce the exact same
    # token, not just a token the other can verify. Time is pinned so both
    # implementations embed identical iat/exp claims.
    _, pem, _ = rsa_keypair
    n, d = github_auth._load_private_key(pem)
    monkeypatch.setattr(github_auth.time, "time", lambda: 1_700_000_000)

    ours = github_auth._build_app_jwt("12345", n, d)
    reference = pyjwt.encode(
        {"iat": 1_700_000_000 - 60, "exp": 1_700_000_000 + 540, "iss": "12345"}, pem, algorithm="RS256"
    )

    assert ours == reference


# ---------------------------------------------------------------------------
# installation_token() — minting, caching, and failure handling
# ---------------------------------------------------------------------------


class FakeHTTPResponse:
    def __init__(self, body: bytes, status: int = 200):
        self._body = body
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def read(self):
        return self._body


def test_installation_token_mints_from_a_valid_key_and_verifies_the_jwt(monkeypatch, rsa_keypair, capsys):
    _, pem, public_pem = rsa_keypair
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", pem)

    captured_requests = []

    def fake_urlopen(req, timeout=10):
        captured_requests.append(req)
        auth_header = req.get_header("Authorization")
        app_jwt = auth_header.split(" ", 1)[1]
        # Confirm the Lambda minted a JWT GitHub itself could verify with our
        # key's public half — not just "some string that looks like a JWT".
        pyjwt.decode(app_jwt, public_pem, algorithms=["RS256"])
        return FakeHTTPResponse(json.dumps({"token": "ghs_minted123"}).encode())

    monkeypatch.setattr(github_auth, "urlopen", fake_urlopen)

    token = github_auth.installation_token()

    assert token == "ghs_minted123"
    assert len(captured_requests) == 1
    assert "ERROR" not in capsys.readouterr().out


def test_installation_token_is_cached_across_calls(monkeypatch, rsa_keypair):
    _, pem, _ = rsa_keypair
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", pem)

    mint_calls = []

    def fake_urlopen(req, timeout=10):
        mint_calls.append(req)
        return FakeHTTPResponse(json.dumps({"token": "ghs_minted123"}).encode())

    monkeypatch.setattr(github_auth, "urlopen", fake_urlopen)

    first = github_auth.installation_token()
    second = github_auth.installation_token()

    assert first == second == "ghs_minted123"
    assert len(mint_calls) == 1


def test_installation_token_remints_once_the_cache_is_near_expiry(monkeypatch, rsa_keypair):
    _, pem, _ = rsa_keypair
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", pem)
    mint_calls = []

    def fake_urlopen(req, timeout=10):
        mint_calls.append(req)
        return FakeHTTPResponse(json.dumps({"token": f"ghs_{len(mint_calls)}"}).encode())

    monkeypatch.setattr(github_auth, "urlopen", fake_urlopen)

    github_auth.installation_token()
    github_auth._cached_token = (github_auth._cached_token[0], time.time() + 30)  # inside the 60s refresh window

    second = github_auth.installation_token()

    assert len(mint_calls) == 2
    assert second == "ghs_2"


def test_installation_token_none_when_key_not_configured(monkeypatch, capsys):
    monkeypatch.delenv("GITHUB_APP_PRIVATE_KEY", raising=False)

    assert github_auth.installation_token() is None
    assert "GITHUB_APP_PRIVATE_KEY not configured" in capsys.readouterr().out


def test_installation_token_none_and_logs_on_github_failure(monkeypatch, rsa_keypair, capsys):
    _, pem, _ = rsa_keypair
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", pem)

    def failing_urlopen(req, timeout=10):
        raise TimeoutError("connection timed out")

    monkeypatch.setattr(github_auth, "urlopen", failing_urlopen)

    assert github_auth.installation_token() is None
    assert "ERROR: failed to mint GitHub App installation token" in capsys.readouterr().out


def test_installation_token_none_when_github_returns_no_token(monkeypatch, rsa_keypair, capsys):
    _, pem, _ = rsa_keypair
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", pem)
    monkeypatch.setattr(github_auth, "urlopen", lambda req, timeout=10: FakeHTTPResponse(json.dumps({}).encode()))

    assert github_auth.installation_token() is None
    assert "ERROR: failed to mint GitHub App installation token" in capsys.readouterr().out
