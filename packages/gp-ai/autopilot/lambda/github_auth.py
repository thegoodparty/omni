"""Mints a short-lived GitHub App installation token for the sweep's PR reads.

Pure stdlib — no pyjwt/cryptography/httpx. Unlike agent/github_auth.py (the
Fargate stage runner's copy, which has those as real dependencies), this
Lambda's zip is a plain recursive copy of lambda/ with no pip-install step
(see dispatch.py's module docstring and infrastructure/modules/autopilot-bot's
archive_file resource) — nothing beyond boto3/botocore and the standard
library exists at runtime here. Deliberately not a shared import with
agent/github_auth.py for the same reason every other sibling-module
duplication in this Lambda exists (see handler.py's module docstring): the
Fargate agent and this Lambda deploy independently.

RS256 needs an RSA private-key signature, and stdlib ships no library that
does one. This implements PKCS#1 v1.5 signing directly: a minimal DER reader
for the PKCS#1 RSAPrivateKey SEQUENCE GitHub issues App keys in (the same
format agent/github_auth.py's PEM_HEADER assumes), then Python's own
arbitrary-precision pow() for the modular exponentiation. Verified against
PyJWT's own RS256 output byte-for-byte for a same key/claims pair — PKCS#1
v1.5 is deterministic, so two correct implementations must produce the exact
same signature.
"""

import base64
import hashlib
import json
import os
import time
from urllib.request import Request, urlopen

GITHUB_APP_ID = "3107048"
GITHUB_APP_INSTALLATION_ID = "117364330"
GITHUB_API_BASE_URL = "https://api.github.com"

PEM_HEADER = "-----BEGIN RSA PRIVATE KEY-----"
PEM_FOOTER = "-----END RSA PRIVATE KEY-----"

# The DigestInfo prefix PKCS#1 v1.5 prepends to a raw SHA-256 hash before
# signing (RFC 8017 Appendix B / RFC 3447) — fixed, standard bytes, not a
# secret. Matches Go's crypto/rsa hashPrefixes[SHA256] and every other RS256
# implementation.
_SHA256_DIGESTINFO_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")

# Minted at most once per still-fresh Lambda execution environment: Lambda
# freezes it between warm invocations, and an installation token lives an
# hour against a sweep that runs every 15 minutes, so reusing a cached one
# across warm ticks (not just across the several PR reads within one tick)
# costs nothing and saves a mint call. None until the first successful mint.
_cached_token: tuple[str, float] | None = None


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class _DerReader:
    """Just enough of a DER reader to walk a PKCS#1 RSAPrivateKey SEQUENCE of
    INTEGERs — not a general ASN.1 parser, and deliberately not one: GitHub's
    App keys only ever arrive in this one shape."""

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def _read_length(self) -> int:
        first = self.data[self.pos]
        self.pos += 1
        if first < 0x80:
            return first
        num_bytes = first & 0x7F
        length = int.from_bytes(self.data[self.pos : self.pos + num_bytes], "big")
        self.pos += num_bytes
        return length

    def read_sequence(self) -> "_DerReader":
        tag = self.data[self.pos]
        self.pos += 1
        if tag != 0x30:
            raise ValueError(f"expected DER SEQUENCE (0x30), got {tag:#x}")
        length = self._read_length()
        body = self.data[self.pos : self.pos + length]
        self.pos += length
        return _DerReader(body)

    def read_integer(self) -> int:
        tag = self.data[self.pos]
        self.pos += 1
        if tag != 0x02:
            raise ValueError(f"expected DER INTEGER (0x02), got {tag:#x}")
        length = self._read_length()
        raw = self.data[self.pos : self.pos + length]
        self.pos += length
        return int.from_bytes(raw, "big")


def _parse_pkcs1_rsa_private_key(der: bytes) -> tuple[int, int]:
    """(modulus n, private exponent d) from a PKCS#1 RSAPrivateKey DER blob:
    SEQUENCE { version, n, e, d, p, q, dp, dq, qinv }. Only n and d are read —
    the CRT parameters (p, q, dp, dq, qinv) speed up a real signature, they
    don't change it, and a raw modexp via pow() is fast enough for one JWT
    per sweep tick."""
    reader = _DerReader(der).read_sequence()
    reader.read_integer()  # version
    n = reader.read_integer()
    reader.read_integer()  # e (public exponent) — unused for signing
    d = reader.read_integer()
    return n, d


def _load_private_key(pem: str) -> tuple[int, int]:
    body = pem.replace(PEM_HEADER, "").replace(PEM_FOOTER, "")
    body = "".join(body.split())
    return _parse_pkcs1_rsa_private_key(base64.b64decode(body))


def _rsa_sign_pkcs1v15_sha256(message: bytes, n: int, d: int) -> bytes:
    digest = hashlib.sha256(message).digest()
    digest_info = _SHA256_DIGESTINFO_PREFIX + digest
    k = (n.bit_length() + 7) // 8
    padding_len = k - 3 - len(digest_info)
    if padding_len < 8:
        raise ValueError("RSA key too small for a SHA-256 PKCS#1 v1.5 signature")
    encoded_message = b"\x00\x01" + b"\xff" * padding_len + b"\x00" + digest_info
    signature_int = pow(int.from_bytes(encoded_message, "big"), d, n)
    return signature_int.to_bytes(k, "big")


def _build_app_jwt(app_id: str, n: int, d: int) -> str:
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url(json.dumps({"iat": now - 60, "exp": now + 540, "iss": app_id}, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}".encode()
    signature = _rsa_sign_pkcs1v15_sha256(signing_input, n, d)
    return f"{header}.{payload}.{_b64url(signature)}"


def _mint_installation_token(private_key_pem: str) -> str:
    app_id = os.environ.get("GITHUB_APP_ID", GITHUB_APP_ID)
    installation_id = os.environ.get("GITHUB_APP_INSTALLATION_ID", GITHUB_APP_INSTALLATION_ID)
    n, d = _load_private_key(private_key_pem)
    app_jwt = _build_app_jwt(app_id, n, d)
    req = Request(
        f"{GITHUB_API_BASE_URL}/app/installations/{installation_id}/access_tokens",
        data=b"{}",
        headers={
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=10) as response:
        result = json.loads(response.read().decode())
    token = result.get("token")
    if not token:
        raise ValueError("GitHub returned an empty installation token")
    return str(token)


def installation_token() -> str | None:
    """A cached installation token, or None if minting is impossible (no key
    configured) or failed (the GitHub call itself errored) — every caller
    treats None identically to "no read happened", never as an empty-string
    credential. See the module-level cache comment for why a still-fresh
    token is reused rather than re-minted on every call."""
    global _cached_token
    if _cached_token is not None:
        token, expires_at = _cached_token
        if time.time() < expires_at - 60:
            return token

    private_key_pem = os.environ.get("GITHUB_APP_PRIVATE_KEY", "")
    if not private_key_pem:
        print("ERROR: GITHUB_APP_PRIVATE_KEY not configured; cannot mint a GitHub token")
        return None
    try:
        token = _mint_installation_token(private_key_pem)
    except Exception as e:
        print(f"ERROR: failed to mint GitHub App installation token: {type(e).__name__}: {e}")
        return None
    _cached_token = (token, time.time() + 3600)
    return token
