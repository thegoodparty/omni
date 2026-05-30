"""
qa_validate.py — Validate a qa-spine-compliant artifact against the QA protocol.

Product-agnostic. Reads a single unified artifact JSON whose shape matches the
qa-spine input contract: a top-level `claims[]` array (each with `claim_id`,
`claim_text`, `claim_type`, `claim_weight`, `source_ids`, `source_extracts`)
and a top-level `sources[]` array (each with `id`, `source_type`,
`retrieved_text_or_snapshot`). Product-specific rules — which fields count
as identity, which items are priority, which phrases are prohibited, how
product_id is derived — live in the product_spec JSON, not in this file.

Runs in order:
  1. Load artifact     — file exists and is valid JSON
  2. Deterministic     — rule-based checks (no LLM); hard blocks and annotations
  3. Phase 1 (Anthropic) — triage all claims
  4. Phase 2 (Gemini)  — escalate high-weight Phase-1-not-OK claims only
  5. Route             — Block / OK
  6. Write qa_bundle.json next to the artifact

Usage:
    uv run python qa_validate.py path/to/meeting_briefing.json
    uv run python qa_validate.py path/to/meeting_briefing.json --no-llm
    uv run python qa_validate.py path/to/meeting_briefing.json \\
        --product-spec path/to/meeting_briefing_product_spec.json

Loads credentials from ~/Research/.env (via scripts/.env symlink):
  ANTHROPIC_API_KEY — Phase 1 triage judge
  gemini-qa-agent   — Phase 2 escalation judge (lowercase-hyphenated literal name)

Product spec default: meeting_briefing_product_spec.json (same directory as this script).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from dotenv import load_dotenv
from pydantic import BaseModel


# ── Environment ───────────────────────────────────────────────────────────────

def _load_env() -> None:
    # scripts/.env is the in-repo convention. In Fargate the task definition + Secrets
    # Manager populate os.environ at task launch and no .env file is needed; load_dotenv
    # is a harmless no-op when the file is missing. Locally, contributors keep their
    # credentials in scripts/.env (real file or symlink — python-dotenv handles both
    # transparently; it does NOT crash on broken symlinks).
    script_env = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(script_env)


# ── Product spec ──────────────────────────────────────────────────────────────

def load_product_spec(spec_path: Optional[Path] = None) -> dict:
    if spec_path is None:
        spec_path = Path(__file__).parent / "meeting_briefing_product_spec.json"
    if not spec_path.exists():
        sys.exit(f"ERROR: Product spec not found: {spec_path}")
    spec = json.loads(spec_path.read_text())
    # Record where the spec was loaded from so repo-relative paths declared in
    # the spec (e.g. output_format.schema.manifest_path) can be resolved.
    spec["_spec_path"] = str(spec_path.resolve())
    return spec


def blockable_types(spec: dict) -> set[str]:
    return {k for k, v in spec["claim_types"].items() if v.get("blockable")}


def ok_categories(spec: dict) -> set[str]:
    return set(spec["accuracy_categories"]["ok"])


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class DeterministicCheck:
    check_id: str
    status: Literal["pass", "fail", "warning"]
    severity: str
    message: str
    # 'diagnostic' is recorded in the bundle but never drives the release
    # verdict (see compute_release_verdict) — used for non-verdict signals
    # like a missing source-hierarchy policy gap.
    route: Literal["block", "annotate", "pass", "diagnostic"]
    offending: str = ""
    details: Optional[dict] = None  # structured per-check measurements for inspection


@dataclass
class Phase1Result:
    claim_id: str
    accuracy_category: str
    reasoning: str
    is_ok: bool


@dataclass
class Phase2Result:
    claim_id: str
    accuracy_category: str
    reasoning: str
    is_ok: bool
    proposed_correction: Optional[str] = None


@dataclass
class ClaimTrace:
    claim: dict
    phase1: Optional[Phase1Result] = None
    phase2: Optional[Phase2Result] = None
    final_route: str = "ok"


# ── Load artifact ─────────────────────────────────────────────────────────────

def load_artifact(artifact_path: Path) -> tuple[dict, list[DeterministicCheck]]:
    """Load the meeting_briefing artifact JSON. Returns (artifact, list-of-load-checks)."""
    results: list[DeterministicCheck] = []
    if not artifact_path.exists():
        results.append(DeterministicCheck(
            check_id="artifact_present",
            status="fail", severity="high",
            message=f"Artifact not found at {artifact_path}",
            route="block",
        ))
        return {}, results
    try:
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        results.append(DeterministicCheck(
            check_id="artifact_present",
            status="fail", severity="high",
            message=f"Artifact is invalid JSON: {e}",
            route="block",
        ))
        return {}, results
    results.append(DeterministicCheck(
        check_id="artifact_present",
        status="pass", severity="info",
        message="Artifact loaded successfully",
        route="pass",
    ))
    return artifact, results


# ── Layer-1 schema validation (WS2) ───────────────────────────────────────────

def _spec_dir(spec: dict) -> Path:
    """Directory the product spec was loaded from; repo-relative manifest paths
    in output_format.schema.manifest_path resolve against the repo root, which we
    locate by walking up from the spec dir until we find experiments/."""
    sp = spec.get("_spec_path")
    base = Path(sp).resolve().parent if sp else Path(__file__).resolve().parent
    return base


def _resolve_repo_relative(spec: dict, rel: str) -> Optional[Path]:
    """Resolve a repo-relative path (e.g. 'experiments/.../manifest.json').

    Walks up from the spec's directory looking for a parent that contains the
    given relative path. Returns the first hit or None. Keeps the spine free of
    hard-coded absolute paths (portability rule)."""
    start = _spec_dir(spec)
    for base in [start, *start.parents]:
        candidate = base / rel
        if candidate.exists():
            return candidate
    return None


def schema_validate_layer1(
    artifact: dict, spec: dict, output_format: dict
) -> Optional[DeterministicCheck]:
    """Layer-1 jsonschema validation against the manifest output_schema.

    Returns a DeterministicCheck (the spine inserts it FIRST), or None when the
    resolved output type does not call for schema_layer1 (e.g. inline_cited_prose).

    Routing/edge-case behavior (resolved defaults):
      - output_format.schema absent      → skip-with-warning (never silent-skip).
      - manifest / schema_key unreadable → skip-with-warning.
      - jsonschema import unavailable    → skip-with-warning (strictest could not
        run; surfaced, not silently dropped).
      - schema present & artifact invalid → BLOCK (hard-fail on shape drift).
      - schema present & artifact valid   → pass.
    It never re-penalizes an artifact already rejected at load (invalid JSON
    never reaches here — main() halts first), so no double-penalty.
    """
    if not output_format["routes"].get("schema_layer1"):
        return None

    sch = output_format["schema"]
    if not sch or not sch.get("manifest_path"):
        return DeterministicCheck(
            check_id="schema_validation",
            status="warning", severity="medium",
            message=(
                "Layer-1 schema validation skipped: output_format.schema.manifest_path "
                "not declared (skip-with-warning; never silent-skip)"
            ),
            route="annotate",
            details={"reason": "no_manifest_path"},
        )

    manifest_path = _resolve_repo_relative(spec, sch["manifest_path"])
    if manifest_path is None:
        return DeterministicCheck(
            check_id="schema_validation",
            status="warning", severity="medium",
            message=f"Layer-1 schema validation skipped: manifest not found at {sch['manifest_path']!r}",
            route="annotate",
            details={"reason": "manifest_not_found", "manifest_path": sch["manifest_path"]},
        )

    try:
        manifest = json.loads(manifest_path.read_text())
        schema = manifest[sch.get("schema_key", "output_schema")]
    except Exception as e:  # noqa: BLE001 — any read/parse failure is skip-with-warning
        return DeterministicCheck(
            check_id="schema_validation",
            status="warning", severity="medium",
            message=f"Layer-1 schema validation skipped: could not load schema ({e})",
            route="annotate",
            details={"reason": "schema_unreadable", "error": str(e)},
        )

    try:
        from jsonschema import Draft7Validator
    except ImportError:
        return DeterministicCheck(
            check_id="schema_validation",
            status="warning", severity="medium",
            message=(
                "Layer-1 schema validation skipped: jsonschema not installed "
                "(strictest route could not run; surfaced, not silent-skipped)"
            ),
            route="annotate",
            details={"reason": "jsonschema_unavailable"},
        )

    errors = sorted(Draft7Validator(schema).iter_errors(artifact), key=lambda e: list(e.path))
    if errors:
        preview = [
            {"path": "$." + ".".join(str(p) for p in e.path), "message": e.message}
            for e in errors[:8]
        ]
        return DeterministicCheck(
            check_id="schema_validation",
            status="fail", severity="high",
            message=(
                f"Artifact failed Layer-1 schema validation: {len(errors)} error(s) "
                f"against {manifest_path.name} output_schema"
            ),
            route="block",
            offending="; ".join(f"{p['path']}: {p['message']}" for p in preview[:5]),
            details={"manifest": manifest_path.name, "error_count": len(errors), "errors": preview},
        )
    return DeterministicCheck(
        check_id="schema_validation",
        status="pass", severity="info",
        message=f"Artifact passed Layer-1 schema validation against {manifest_path.name} output_schema",
        route="pass",
        details={"manifest": manifest_path.name},
    )


# ── Path walker (for spec-declared field paths) ───────────────────────────────

def _walk(obj, dotted: str):
    """Walk a dotted-path through a dict; return the leaf value or None."""
    for part in dotted.split("."):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(part)
        if obj is None:
            return None
    return obj


def _values_at_path(artifact: dict, path: str) -> list[str]:
    """Resolve a spec path to a list of non-empty string values.

    Supported forms:
      'top_field'                       → [artifact['top_field']] if string-valued
      'parent.child'                    → [artifact['parent']['child']] if string-valued
      'items[].x.y'                     → [item.x.y for each item in artifact['items']]
      'parent.items[].leaf'             → [entry.leaf for each entry in artifact['parent']['items']]
    """
    if "[]." in path:
        before, _, after = path.partition("[].")
        # _walk resolves dotted prefixes like 'executive_summary.items'.
        container = _walk(artifact, before)
        if not isinstance(container, list):
            return []
        results: list[str] = []
        for entry in container:
            if not isinstance(entry, dict):
                continue
            value = _walk(entry, after)
            if isinstance(value, str) and value.strip():
                results.append(value)
        return results
    value = _walk(artifact, path)
    return [value] if isinstance(value, str) and value.strip() else []


# ── Output-format routing backbone (WS2 foundation) ───────────────────────────
#
# A product spec declares output_format.type so the spine routes validation by
# artifact shape instead of assuming one structure. The mechanism is generic:
# the spine knows a small set of known types and which validation families each
# runs; product-specific detail (which manifest, which inline-citation pattern)
# lives in the product spec, never here.

# Known artifact-shape types → the validation families the spine runs for them.
# Families are advisory routing labels read by run_deterministic; adding a type
# here is how a new artifact shape opts into the routing backbone.
VALIDATION_ROUTES: dict[str, dict] = {
    # A single JSON object validated by jsonschema (Layer 1) plus the standard
    # claim/source deterministic family.
    "structured_json": {"schema_layer1": True, "claim_source_family": True},
    # Free prose with inline citations — no whole-document jsonschema, but the
    # claim/source family still applies once claims are extracted.
    "inline_cited_prose": {"schema_layer1": False, "claim_source_family": True},
}

# When output_format.type is missing or unparseable we route to the STRICTEST
# known type and warn — never silent-skip. Strictest = the one that runs the
# most validation (schema_layer1 + claim_source_family).
_STRICTEST_OUTPUT_TYPE = "structured_json"


def resolve_output_format(spec: dict) -> dict:
    """Normalize spec.output_format into a routing descriptor.

    Returns a dict with:
      type        — the resolved (possibly defaulted) type string
      routes      — the VALIDATION_ROUTES entry for that type
      warnings    — list of human-readable routing warnings (never raises)
      defaulted   — True when we fell back to the strictest type
      schema      — the raw output_format.schema block (or {})
      inline_citation_pattern — regex string or None

    Edge case (resolved default): a missing or unparseable type routes to the
    strictest validation and warns; it never silent-skips. Blocking only happens
    downstream if the strictest route cannot run (e.g. schema unavailable), and
    that is surfaced by the individual check, not here.
    """
    of = spec.get("output_format") or {}
    warnings: list[str] = []
    raw_type = of.get("type")
    defaulted = False
    if not isinstance(raw_type, str) or raw_type not in VALIDATION_ROUTES:
        if raw_type is None:
            warnings.append(
                f"output_format.type missing — routing to strictest "
                f"validation ('{_STRICTEST_OUTPUT_TYPE}')"
            )
        else:
            warnings.append(
                f"output_format.type {raw_type!r} unrecognized — routing to "
                f"strictest validation ('{_STRICTEST_OUTPUT_TYPE}')"
            )
        resolved_type = _STRICTEST_OUTPUT_TYPE
        defaulted = True
    else:
        resolved_type = raw_type
    return {
        "type": resolved_type,
        "routes": VALIDATION_ROUTES[resolved_type],
        "warnings": warnings,
        "defaulted": defaulted,
        "schema": of.get("schema") or {},
        "inline_citation_pattern": of.get("inline_citation_pattern"),
    }


# Default inline-citation token shapes if a spec declares none: [1], [S1],
# [src_1], [src-12]. Conservative — bracketed numeric/alphanumeric refs only.
_DEFAULT_INLINE_CITATION_RE = re.compile(r"\[(?:src[_-]?)?[A-Za-z]*\d+\]")


def extract_inline_citations(text: str, pattern: Optional[str] = None) -> list[dict]:
    """Generic inline-citation extractor.

    Pulls bracketed citation tokens (e.g. '[src_1]', '[S3]', '[12]') out of prose
    and returns them with their character spans, so a caller can map inline
    citations back to sources[] or flag uncited prose. Product-specific token
    shapes come from spec.output_format.inline_citation_pattern; absent that, a
    conservative default pattern is used.

    Returns a list of {token, ref, start, end} dicts in order of appearance.
    'ref' is the token with surrounding brackets and any 'src'/'S' prefix
    stripped to the bare identifier (best-effort; callers that need exact
    matching should use 'token').
    """
    if not text:
        return []
    rx = re.compile(pattern) if pattern else _DEFAULT_INLINE_CITATION_RE
    out: list[dict] = []
    for m in rx.finditer(text):
        token = m.group(0)
        ref = token.strip("[]")
        ref = re.sub(r"(?i)^src[_-]?", "", ref)
        out.append({"token": token, "ref": ref, "start": m.start(), "end": m.end()})
    return out


# ── High-stakes literal extractors (WS2 structured validators) ────────────────
#
# Each extractor pulls every literal of one kind out of a piece of text and
# returns them as NORMALIZED comparison keys. The spine's structured-validator
# check requires every literal extracted from a claim_text to be present (by
# normalized key) in at least one cited source snapshot. These are extraction
# rules, not calibrated thresholds — the only numeric knob (money/percentage
# rounding tolerance) defaults to exact and any non-zero value must come from a
# committed fixture, never invented here.

_MONEY_RE = re.compile(
    r"\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(?:million|billion|thousand|m|bn|k)?",
    re.IGNORECASE,
)
_PERCENT_RE = re.compile(r"\d+(?:\.\d+)?\s?(?:%|percent)", re.IGNORECASE)
_VOTE_RE = re.compile(r"\b\d{1,3}\s?[-–to]{1,3}\s?\d{1,3}\b", re.IGNORECASE)
# Legal citations: "Ordinance 2024-17", "Resolution No. 12", "Section 3.4",
# "Ord. 17", "HB 1234", "Chapter 5", "Article IV".
_LEGAL_RE = re.compile(
    r"\b(?:ordinance|resolution|res|ord|section|sec|chapter|ch|article|art|"
    r"bill|hb|sb|case|docket|cause|no)\.?\s?(?:no\.?\s?)?[A-Za-z]?\d[\w.\-/]*",
    re.IGNORECASE,
)
_DATE_RE = re.compile(
    r"\b(?:"
    r"\d{4}-\d{2}-\d{2}"  # 2026-06-01
    r"|\d{1,2}/\d{1,2}/\d{2,4}"  # 6/1/2026
    r"|(?:January|February|March|April|May|June|July|August|September|October|"
    r"November|December)\s+\d{1,2}(?:,\s*\d{4})?"  # June 1, 2026
    r")\b",
    re.IGNORECASE,
)
# Proper-noun name runs: 1+ capitalized words (allows middle initials, hyphens).
# Heuristic — drops common sentence-initial false positives is left to the
# caller; for high-stakes matching we only require the run appears in source.
_NAME_RE = re.compile(r"\b(?:[A-Z][a-z]+(?:\.|)\s?){2,}")


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _norm_money(tok: str) -> str:
    """Normalize a money literal to a canonical numeric magnitude string.

    '$1,800,000' and '$1.8 million' both normalize to '1800000'. This lets the
    exact-match compare across surface forms while still catching a $1.8M vs $2M
    swap (different magnitudes → different keys).
    """
    t = tok.lower().replace("$", "").replace(",", "").strip()
    mult = 1
    for word, m in (("billion", 1_000_000_000), ("bn", 1_000_000_000),
                    ("million", 1_000_000), ("m", 1_000_000),
                    ("thousand", 1_000), ("k", 1_000)):
        if t.endswith(word):
            mult = m
            t = t[: -len(word)].strip()
            break
    try:
        val = float(t) * mult
    except ValueError:
        return _norm_text(tok)
    # Integer-valued magnitudes render without a trailing .0
    return str(int(val)) if val == int(val) else str(val)


def _norm_percent(tok: str) -> str:
    t = re.sub(r"(?i)\s*(?:%|percent)\s*$", "", tok).strip()
    try:
        val = float(t)
    except ValueError:
        return _norm_text(tok)
    return f"{val:g}%"


def _norm_vote(tok: str) -> str:
    nums = re.findall(r"\d+", tok)
    return "-".join(nums)


# kind → (compiled regex, normalizer). Used by the structured-validator check
# and by tests. Adding a kind is purely additive here.
STRUCTURED_EXTRACTORS: dict[str, tuple] = {
    "money": (_MONEY_RE, _norm_money),
    "percentage": (_PERCENT_RE, _norm_percent),
    "vote_count": (_VOTE_RE, _norm_vote),
    "legal_citation": (_LEGAL_RE, _norm_text),
    "date": (_DATE_RE, _norm_text),
    "name": (_NAME_RE, _norm_text),
}


def extract_literals(text: str, kind: str) -> list[str]:
    """Extract every literal of `kind` from text, returned as normalized keys.

    Unknown kind → empty list (the caller treats an unconfigured kind as
    "nothing to check", not an error).
    """
    spec = STRUCTURED_EXTRACTORS.get(kind)
    if not spec or not text:
        return []
    rx, norm = spec
    seen: list[str] = []
    for m in rx.finditer(text):
        key = norm(m.group(0))
        if key and key not in seen:
            seen.append(key)
    return seen


def _format_safe(template: str, data: dict) -> str:
    """Substitute {key} references in template; missing keys become 'unknown'."""
    def repl(m: re.Match) -> str:
        key = m.group(1)
        value = data.get(key)
        return str(value) if value else "unknown"
    return re.sub(r"\{([^{}]+)\}", repl, template)


# ── Source-extract normalization (legacy string vs structured object) ────────

def _extract_text(extract) -> str:
    """source_extracts items are either strings (legacy) or objects with `text` (preferred)."""
    if isinstance(extract, str):
        return extract
    if isinstance(extract, dict):
        return extract.get("text") or ""
    return ""


def _extract_section_header(extract) -> str:
    """Returns the section_header if extract is in object form, empty string for legacy strings."""
    if isinstance(extract, dict):
        return extract.get("section_header") or ""
    return ""


def _extract_type(extract) -> str:
    """Returns extract_type if extract is in object form, 'unknown' for legacy strings."""
    if isinstance(extract, dict):
        return extract.get("extract_type") or "unknown"
    return "unknown"


def _iter_extract_texts(extracts) -> list[str]:
    """Pull text strings out of a source_extracts list, filtering empties."""
    out: list[str] = []
    for e in extracts or []:
        t = _extract_text(e)
        if t and t.strip():
            out.append(t)
    return out


# ── Scoring helpers (coherence check) ─────────────────────────────────────────

_WORD_RE = re.compile(r"\b[a-z]{2,}\b")


def _tokenize(s: str) -> list[str]:
    return _WORD_RE.findall(s.lower())


def _tfidf_cosine(a_text: str, b_text: str) -> float:
    toks_a, toks_b = _tokenize(a_text), _tokenize(b_text)
    if not toks_a or not toks_b:
        return 0.0
    tf_a, tf_b = Counter(toks_a), Counter(toks_b)
    vocab = set(tf_a) | set(tf_b)

    def idf(tok: str) -> float:
        df = (1 if tok in tf_a else 0) + (1 if tok in tf_b else 0)
        return math.log((2 + 1) / (df + 1)) + 1

    va = {t: tf_a[t] * idf(t) for t in vocab}
    vb = {t: tf_b[t] * idf(t) for t in vocab}
    dot = sum(va[t] * vb[t] for t in vocab)
    na = math.sqrt(sum(v * v for v in va.values()))
    nb = math.sqrt(sum(v * v for v in vb.values()))
    return dot / (na * nb) if na and nb else 0.0


def _containment(summary: str, source: str) -> float:
    s = set(_tokenize(summary))
    if not s:
        return 0.0
    e = set(_tokenize(source))
    return len(s & e) / len(s)


# Module-level cache: model_name → loaded SentenceTransformer (or None if load failed).
# Lazy-loaded on first call so the import cost is paid only when the coherence
# check actually runs an embedding pass.
_EMBEDDING_MODEL_CACHE: dict = {}


def _embedding_cosine(a_text: str, b_text: str, model_name: str) -> float | None:
    """Semantic cosine similarity between two strings via a local sentence-transformer.

    Returns None when the dependency is missing or the model fails to load — the
    caller treats None as "skip embedding signal", same convention as ROUGE-L.
    Returns 0.0 when either input is empty.

    Embedding cosine catches paraphrases that TF-IDF + containment miss (different
    vocabulary expressing the same meaning), but is brittle against small factual
    swaps ("$1.8M" vs "$2M" can score ~0.99). Used as a rescue signal for the
    lexical verdict, not as a primary failure detector.
    """
    if not a_text.strip() or not b_text.strip():
        return 0.0
    if model_name not in _EMBEDDING_MODEL_CACHE:
        try:
            from sentence_transformers import SentenceTransformer
            _EMBEDDING_MODEL_CACHE[model_name] = SentenceTransformer(model_name)
        except Exception:
            _EMBEDDING_MODEL_CACHE[model_name] = None
    model = _EMBEDDING_MODEL_CACHE[model_name]
    if model is None:
        return None
    try:
        vecs = model.encode([a_text, b_text], normalize_embeddings=True, show_progress_bar=False)
        return float(vecs[0] @ vecs[1])
    except Exception:
        return None


# ── Deterministic checks ──────────────────────────────────────────────────────

def run_deterministic(
    artifact: dict,
    spec: dict,
) -> list[DeterministicCheck]:
    results: list[DeterministicCheck] = []
    items = artifact.get("items") or []
    claims = artifact.get("claims") or []
    sources = artifact.get("sources") or []

    # 0. output_format routing (WS2 backbone). Resolve which validation families
    #    run for this artifact shape. Missing/unparseable type → strictest + warn.
    output_format = resolve_output_format(spec)
    for w in output_format["warnings"]:
        results.append(DeterministicCheck(
            check_id="output_format_routing",
            status="warning", severity="medium",
            message=w,
            route="annotate",
            details={"resolved_type": output_format["type"], "defaulted": output_format["defaulted"]},
        ))

    # 0b. Layer-1 schema validation — runs BEFORE every other check; hard-fails
    #     on shape drift, skip-with-warning when schema/jsonschema unavailable.
    layer1 = schema_validate_layer1(artifact, spec, output_format)
    if layer1 is not None:
        results.append(layer1)

    # 1. Identity fields present (driven by spec.identity_fields)
    identity_fields = spec.get("identity_fields") or []
    missing_id = [f for f in identity_fields if not artifact.get(f)]
    if missing_id:
        results.append(DeterministicCheck(
            check_id="identity_fields_present",
            status="fail", severity="high",
            message=f"Top-level identity fields missing: {missing_id}",
            route="block",
        ))
    else:
        results.append(DeterministicCheck(
            check_id="identity_fields_present",
            status="pass", severity="info",
            message=f"Identity fields present: {identity_fields}",
            route="pass",
        ))

    # 2. Priority-item count when briefing_status indicates a full briefing
    pf = spec.get("priority_filter") or {}
    priority_field = pf.get("field", "tier")
    priority_value = pf.get("value", "featured")
    priority_required_status = spec.get("priority_required_status")
    priority_items = [it for it in items if it.get(priority_field) == priority_value]
    status_field = artifact.get("briefing_status")
    if priority_required_status and status_field == priority_required_status and not priority_items:
        results.append(DeterministicCheck(
            check_id="priority_count_nonzero",
            status="fail", severity="high",
            message=(
                f"briefing_status='{status_field}' but no items match priority_filter "
                f"({priority_field}={priority_value!r})"
            ),
            route="block",
        ))
    else:
        results.append(DeterministicCheck(
            check_id="priority_count_nonzero",
            status="pass", severity="info",
            message=f"{len(priority_items)} priority item(s) present (status={status_field})",
            route="pass",
        ))

    # 3. High-weight / blockable-type claims must have non-empty source_extracts
    high_types = blockable_types(spec)
    def _has_extract(c: dict) -> bool:
        return bool(_iter_extract_texts(c.get("source_extracts") or []))
    no_extract = [
        c.get("claim_id", "<no-id>") for c in claims
        if (c.get("claim_type") in high_types or c.get("claim_weight") == "high")
        and not _has_extract(c)
    ]
    if no_extract:
        results.append(DeterministicCheck(
            check_id="high_weight_claims_have_extracts",
            status="fail", severity="high",
            message=f"High-weight/blockable claims with no source extract: {no_extract}",
            route="block",
            offending=", ".join(no_extract),
        ))
    else:
        results.append(DeterministicCheck(
            check_id="high_weight_claims_have_extracts",
            status="pass", severity="info",
            message="All high-weight/blockable claims have source extracts",
            route="pass",
        ))

    # 3b. Every claim (regardless of weight) must have non-empty source_ids AND source_extracts.
    #     Belt-and-suspenders with #3 above (which only covers high-weight extracts).
    #     Routes block if any failing claim is high-weight/blockable; annotates otherwise.
    missing_sources: list[dict] = []
    missing_extracts: list[dict] = []
    for c in claims:
        cid = c.get("claim_id", "<no-id>")
        weight = c.get("claim_weight", "?")
        ctype = c.get("claim_type", "?")
        is_high = (weight == "high") or (ctype in high_types)
        if not (c.get("source_ids") or []):
            missing_sources.append({"claim_id": cid, "weight": weight, "type": ctype, "is_high": is_high})
        if not _has_extract(c):
            missing_extracts.append({"claim_id": cid, "weight": weight, "type": ctype, "is_high": is_high})
    prov_details = {
        "missing_source_ids": missing_sources,
        "missing_source_extracts": missing_extracts,
        "totals": {
            "claims_total": len(claims),
            "missing_source_ids": len(missing_sources),
            "missing_source_extracts": len(missing_extracts),
        },
    }
    if missing_sources or missing_extracts:
        block_level = any(r["is_high"] for r in missing_sources + missing_extracts)
        msg_parts = []
        if missing_sources:
            msg_parts.append(f"{len(missing_sources)} claim(s) missing source_ids")
        if missing_extracts:
            msg_parts.append(f"{len(missing_extracts)} claim(s) missing source_extracts")
        results.append(DeterministicCheck(
            check_id="all_claims_have_provenance",
            status="fail" if block_level else "warning",
            severity="high" if block_level else "medium",
            message="; ".join(msg_parts) + (" (high-weight failure → block)" if block_level else ""),
            route="block" if block_level else "annotate",
            offending="; ".join(
                f"{r['claim_id']}({r['weight']})"
                for r in (missing_sources + missing_extracts)[:6]
            ),
            details=prov_details,
        ))
    else:
        results.append(DeterministicCheck(
            check_id="all_claims_have_provenance",
            status="pass", severity="info",
            message=f"All {len(claims)} claim(s) have source_ids and source_extracts",
            route="pass",
            details=prov_details,
        ))

    # 4. Claim source_ids resolve to known sources (using source.id)
    source_id_set = {s.get("id") for s in sources if s.get("id")}
    broken_citations = [
        f"{c.get('claim_id', '<no-id>')}→{sid}"
        for c in claims
        for sid in (c.get("source_ids") or [])
        if sid not in source_id_set
    ]
    if broken_citations:
        results.append(DeterministicCheck(
            check_id="citation_ids_resolve",
            status="fail", severity="high",
            message=f"Broken source_id references on claims: {broken_citations}",
            route="block",
            offending=", ".join(broken_citations),
        ))
    else:
        results.append(DeterministicCheck(
            check_id="citation_ids_resolve",
            status="pass", severity="info",
            message="All claim source_ids resolve to known sources",
            route="pass",
        ))

    # 5. Every source has non-empty retrieved_text_or_snapshot
    empty_snapshots = [
        s.get("id") or "<no-id>"
        for s in sources
        if not (s.get("retrieved_text_or_snapshot") or "").strip()
    ]
    if empty_snapshots:
        results.append(DeterministicCheck(
            check_id="source_snapshots_present",
            status="warning", severity="medium",
            message=f"Sources with empty retrieved_text_or_snapshot: {empty_snapshots}",
            route="annotate",
            offending=", ".join(empty_snapshots),
        ))
    else:
        results.append(DeterministicCheck(
            check_id="source_snapshots_present",
            status="pass", severity="info",
            message="All sources carry retrieved_text_or_snapshot content",
            route="pass",
        ))

    # 6. Prohibited phrases — scan the spec-declared prose paths
    #    (Sections like talking_points with a posture override are EXCLUDED by
    #    being absent from spec.prohibited_phrase_paths.)
    phrase_specs = spec.get("prohibited_phrases") or []
    path_specs = spec.get("prohibited_phrase_paths") or []
    prose_parts: list[str] = []
    for p in path_specs:
        prose_parts.extend(_values_at_path(artifact, p))
    prose = " ".join(prose_parts)
    hit_names: list[str] = []
    for entry in phrase_specs:
        name = entry.get("name") or entry.get("pattern", "<unnamed>")
        pattern = entry.get("pattern", "")
        if pattern and re.search(pattern, prose, re.IGNORECASE):
            hit_names.append(name)
    if hit_names:
        results.append(DeterministicCheck(
            check_id="prohibited_phrases",
            status="warning", severity="low",
            message=(
                "Directive language detected in non-override prose. "
                f"Paths scanned: {path_specs}. "
                "Sections like talking_points are exempt by not being in the path list."
            ),
            route="annotate",
            offending="; ".join(hit_names),
        ))
    else:
        results.append(DeterministicCheck(
            check_id="prohibited_phrases",
            status="pass", severity="info",
            message=f"No prohibited phrases found across {len(path_specs)} prose path(s)",
            route="pass",
        ))

    # 7. extracts_appear_in_cited_source — bounded to cited sources only,
    #    with rapidfuzz partial_ratio fallback inside the SAME cited source(s).
    #    High-weight failures block; lower-weight failures annotate.
    fuzzy_cfg = spec.get("substring_check") or {}
    fuzzy_threshold = fuzzy_cfg.get("fuzzy_threshold", 90)
    source_map = {s["id"]: s for s in sources if s.get("id")}
    blockable = blockable_types(spec)

    def _norm(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip().lower()

    def _is_high_weight(c: dict) -> bool:
        return c.get("claim_weight") == "high" or c.get("claim_type") in blockable

    try:
        from rapidfuzz import fuzz
        _have_rapidfuzz = True
    except ImportError:
        _have_rapidfuzz = False

    high_failures: list[str] = []
    other_failures: list[str] = []
    fuzzy_only: list[str] = []
    per_claim_trace: list[dict] = []  # provenance for inspection
    exact_count = 0
    for claim in claims:
        cid = claim.get("claim_id", "<no-id>")
        cited_haystacks: list[str] = []
        for sid in claim.get("source_ids") or []:
            text = (source_map.get(sid, {}).get("retrieved_text_or_snapshot") or "")
            if text:
                cited_haystacks.append(_norm(text))
        for ex in claim.get("source_extracts") or []:
            ex_text = _extract_text(ex)
            if not ex_text.strip():
                continue
            needle = _norm(ex_text)
            # Exact substring in any cited source
            exact_hit = any(needle in haystack for haystack in cited_haystacks)
            # Fuzzy fallback — only within the SAME cited sources
            best = 0
            if _have_rapidfuzz and cited_haystacks:
                best = max(
                    (int(fuzz.partial_ratio(needle, h)) for h in cited_haystacks),
                    default=0,
                )
            snippet = (ex_text[:60] + "…") if len(ex_text) > 60 else ex_text
            if exact_hit:
                outcome = "exact"
                exact_count += 1
            elif best >= fuzzy_threshold:
                outcome = "fuzzy"
                fuzzy_only.append(f"{cid}: '{snippet}' (best_fuzzy={best})")
            elif _is_high_weight(claim):
                outcome = "fail_high_weight"
                high_failures.append(f"{cid}: '{snippet}' (best_fuzzy={best})")
            else:
                outcome = "fail_other"
                other_failures.append(f"{cid}: '{snippet}' (best_fuzzy={best})")
            per_claim_trace.append({
                "claim_id": cid,
                "claim_weight": claim.get("claim_weight"),
                "cited_source_ids": claim.get("source_ids") or [],
                "extract_preview": snippet,
                "outcome": outcome,
                "fuzzy_score": best if outcome != "exact" else None,
            })

    substring_details = {
        "fuzzy_threshold": fuzzy_threshold,
        "rapidfuzz_available": _have_rapidfuzz,
        "totals": {
            "extracts_checked": len(per_claim_trace),
            "exact_pass": exact_count,
            "fuzzy_pass": len(fuzzy_only),
            "fail_high_weight": len(high_failures),
            "fail_other": len(other_failures),
        },
        "per_extract": per_claim_trace,
    }
    if high_failures:
        results.append(DeterministicCheck(
            check_id="extracts_appear_in_cited_source",
            status="fail", severity="high",
            message=(
                f"{len(high_failures)} high-weight extract(s) not found in cited "
                f"source (exact or fuzzy ≥ {fuzzy_threshold})"
            ),
            route="block",
            offending="; ".join(high_failures[:5]),
            details=substring_details,
        ))
    elif other_failures:
        results.append(DeterministicCheck(
            check_id="extracts_appear_in_cited_source",
            status="warning", severity="medium",
            message=f"{len(other_failures)} non-high-weight extract(s) not found in cited source",
            route="annotate",
            offending="; ".join(other_failures[:5]),
            details=substring_details,
        ))
    elif fuzzy_only:
        results.append(DeterministicCheck(
            check_id="extracts_appear_in_cited_source",
            status="warning", severity="low",
            message=(
                f"{len(fuzzy_only)} extract(s) matched only via fuzzy "
                f"(threshold {fuzzy_threshold}); likely OCR noise"
            ),
            route="annotate",
            offending="; ".join(fuzzy_only[:5]),
            details=substring_details,
        ))
    else:
        note = "(rapidfuzz unavailable)" if not _have_rapidfuzz else ""
        results.append(DeterministicCheck(
            check_id="extracts_appear_in_cited_source",
            status="pass", severity="info",
            message=f"All extracts found exact-substring in their cited sources {note}".strip(),
            route="pass",
            details=substring_details,
        ))

    # 7b. high_stakes_structured_match (WS2 P0) — per-claim-type opt-in
    #     extraction + exact match for high-stakes literals. For each claim whose
    #     claim_type is declared in spec.structured_validators, extract every
    #     literal of the declared kind from claim_text and require each to appear
    #     (normalized) in a cited source snapshot. High-weight/blockable failures
    #     block; others annotate.
    structured_cfg = spec.get("structured_validators") or {}
    if structured_cfg:
        sv_high_fail: list[str] = []
        sv_other_fail: list[str] = []
        sv_trace: list[dict] = []
        for claim in claims:
            ctype = claim.get("claim_type", "")
            rule = structured_cfg.get(ctype)
            if not rule:
                continue
            kind = rule.get("kind", "")
            literals = extract_literals(claim.get("claim_text", ""), kind)
            if not literals:
                continue
            cited_haystacks = " ".join(
                _norm_text(source_map.get(sid, {}).get("retrieved_text_or_snapshot") or "")
                for sid in (claim.get("source_ids") or [])
            )
            # Compare normalized keys: money/percent compare canonical magnitude,
            # the rest compare normalized substring presence in the haystack.
            missing: list[str] = []
            for lit in literals:
                if kind in ("money", "percentage", "vote_count"):
                    present = lit in extract_literals(cited_haystacks, kind)
                else:
                    present = lit in cited_haystacks
                if not present:
                    missing.append(lit)
            cid = claim.get("claim_id", "<no-id>")
            sv_trace.append({
                "claim_id": cid, "claim_type": ctype, "kind": kind,
                "literals": literals, "missing": missing,
            })
            if missing:
                entry = f"{cid}({kind}): missing {missing[:3]}"
                if _is_high_weight(claim):
                    sv_high_fail.append(entry)
                else:
                    sv_other_fail.append(entry)
        sv_details = {
            "claim_types_checked": list(structured_cfg.keys()),
            "claims_with_literals": len(sv_trace),
            "per_claim": sv_trace,
        }
        if sv_high_fail:
            results.append(DeterministicCheck(
                check_id="high_stakes_structured_match",
                status="fail", severity="high",
                message=f"{len(sv_high_fail)} high-weight claim(s) with high-stakes literals not found in cited source",
                route="block",
                offending="; ".join(sv_high_fail[:5]),
                details=sv_details,
            ))
        elif sv_other_fail:
            results.append(DeterministicCheck(
                check_id="high_stakes_structured_match",
                status="warning", severity="medium",
                message=f"{len(sv_other_fail)} non-high-weight claim(s) with high-stakes literals not found in cited source",
                route="annotate",
                offending="; ".join(sv_other_fail[:5]),
                details=sv_details,
            ))
        else:
            results.append(DeterministicCheck(
                check_id="high_stakes_structured_match",
                status="pass", severity="info",
                message=f"All extracted high-stakes literals found in cited sources ({len(sv_trace)} claim(s) checked)",
                route="pass",
                details=sv_details,
            ))

    # 7c. source_hierarchy_policy (WS2 P0) — spec-declared claim_type → allowed
    #     source_types. A claim citing a source whose source_type is not allowed
    #     for its claim_type is flagged. A claim_type with NO entry yields a
    #     non-blocking diagnostic surfacing the policy gap (not block, not allow).
    hierarchy = spec.get("source_hierarchy") or {}
    if hierarchy:
        source_type_map = {s.get("id"): s.get("source_type") for s in sources if s.get("id")}
        sh_high_fail: list[str] = []
        sh_other_fail: list[str] = []
        sh_gaps: set[str] = set()
        sh_trace: list[dict] = []
        for claim in claims:
            ctype = claim.get("claim_type", "")
            allowed = hierarchy.get(ctype)
            if allowed is None:
                if ctype:
                    sh_gaps.add(ctype)
                continue
            allowed_set = set(allowed)
            violations = []
            for sid in claim.get("source_ids") or []:
                stype = source_type_map.get(sid)
                if stype is not None and stype not in allowed_set:
                    violations.append(f"{sid}={stype}")
            cid = claim.get("claim_id", "<no-id>")
            if violations:
                sh_trace.append({
                    "claim_id": cid, "claim_type": ctype,
                    "allowed": allowed, "violations": violations,
                })
                entry = f"{cid}({ctype}): {violations[:3]} not in {allowed}"
                if _is_high_weight(claim):
                    sh_high_fail.append(entry)
                else:
                    sh_other_fail.append(entry)
        sh_details = {
            "policy": hierarchy,
            "claim_types_without_policy": sorted(sh_gaps),
            "violations": sh_trace,
        }
        if sh_high_fail:
            results.append(DeterministicCheck(
                check_id="source_hierarchy_policy",
                status="fail", severity="high",
                message=f"{len(sh_high_fail)} high-weight claim(s) cite source types not allowed for their claim_type",
                route="block",
                offending="; ".join(sh_high_fail[:5]),
                details=sh_details,
            ))
        elif sh_other_fail:
            results.append(DeterministicCheck(
                check_id="source_hierarchy_policy",
                status="warning", severity="medium",
                message=f"{len(sh_other_fail)} non-high-weight claim(s) cite disallowed source types",
                route="annotate",
                offending="; ".join(sh_other_fail[:5]),
                details=sh_details,
            ))
        elif sh_gaps:
            results.append(DeterministicCheck(
                check_id="source_hierarchy_policy",
                status="warning", severity="low",
                message=(
                    f"No source-hierarchy policy declared for {len(sh_gaps)} claim_type(s): "
                    f"{sorted(sh_gaps)} (diagnostic — not a block, not silent-allow)"
                ),
                route="diagnostic",
                offending=", ".join(sorted(sh_gaps)),
                details=sh_details,
            ))
        else:
            results.append(DeterministicCheck(
                check_id="source_hierarchy_policy",
                status="pass", severity="info",
                message="All claims cite source types allowed for their claim_type",
                route="pass",
                details=sh_details,
            ))

    # 8. summary_source_coherence — TF-IDF cosine + containment between
    #    display.summary and the item's combined source_extracts.
    #    Warns when BOTH lexical signals are below threshold AND a semantic
    #    embedding cosine (if available) does not rescue the item. The AND
    #    on lexical signals guards against single-metric false positives;
    #    the embedding rescue guards against the residual paraphrase
    #    false-positive that lexical metrics can't distinguish from drift.
    #    ROUGE-L is recorded per-item for diagnostic value (does the summary
    #    copy or paraphrase?) but does NOT drive the verdict.
    coh_cfg = spec.get("coherence_check") or {}
    if coh_cfg.get("enabled", False):
        tfidf_threshold = float(coh_cfg.get("tfidf_threshold", 0.30))
        contain_threshold = float(coh_cfg.get("containment_threshold", 0.50))

        try:
            from rouge_score import rouge_scorer
            rouge_l_scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
        except ImportError:
            rouge_l_scorer = None

        emb_cfg = spec.get("embedding_check") or {}
        emb_enabled = bool(emb_cfg.get("enabled", False))
        emb_model_name = str(emb_cfg.get("model", "all-MiniLM-L6-v2"))
        emb_rescue_threshold = float(emb_cfg.get("rescue_threshold", 0.70))
        # WS2 P0 deny-list: claim_types for which embedding rescue is forbidden.
        # Absence from this list means a type stays rescuable.
        rescue_blocklist = set(spec.get("embedding_rescue_blocklist") or [])

        coherence_scope = [
            it for it in items
            if it.get(priority_field) == priority_value or it.get("tier") == "queued"
        ]
        claims_by_item: dict[str, list[dict]] = {}
        for c in claims:
            iid = c.get("item_id")
            if iid:
                claims_by_item.setdefault(iid, []).append(c)

        low_coherence: list[str] = []
        scored = 0
        rescued_count = 0
        emb_available_observed = False
        per_item_scores: list[dict] = []
        for it in coherence_scope:
            iid = it.get("id")
            summary = (it.get("display") or {}).get("summary") or ""
            if not summary.strip():
                continue
            item_extracts: list[str] = []
            for c in claims_by_item.get(iid, []):
                item_extracts.extend(_iter_extract_texts(c.get("source_extracts") or []))
            if not item_extracts:
                continue
            combined = " ".join(item_extracts)
            tfidf = _tfidf_cosine(summary, combined)
            contain = _containment(summary, combined)
            rouge_l = (
                rouge_l_scorer.score(combined, summary)["rougeL"].fmeasure
                if rouge_l_scorer is not None else None
            )
            emb_cos = (
                _embedding_cosine(summary, combined, emb_model_name)
                if emb_enabled else None
            )
            if emb_cos is not None:
                emb_available_observed = True

            # WS2: refuse embedding rescue when ANY claim feeding this item's
            # comparison is of a blocklisted claim_type (numbers, dates, names,
            # vote counts, legal citations, allegations). Deny-list semantics:
            # an item with no blocklisted claim stays rescuable.
            item_claim_types = {
                c.get("claim_type") for c in claims_by_item.get(iid, [])
            }
            rescue_forbidden = bool(item_claim_types & rescue_blocklist)
            blocking_types = sorted(item_claim_types & rescue_blocklist)

            below_lexical = tfidf < tfidf_threshold and contain < contain_threshold
            rescued = (
                below_lexical
                and not rescue_forbidden
                and emb_cos is not None
                and emb_cos >= emb_rescue_threshold
            )
            below = below_lexical and not rescued
            scored += 1
            if rescued:
                rescued_count += 1
            per_item_scores.append({
                "item_id": iid,
                "tier": it.get("tier"),
                "tfidf_cosine": round(tfidf, 3),
                "containment": round(contain, 3),
                "rouge_l": round(rouge_l, 3) if rouge_l is not None else None,
                "embedding_cosine": round(emb_cos, 3) if emb_cos is not None else None,
                "below_lexical": below_lexical,
                "rescued_by_embedding": rescued,
                "rescue_forbidden": rescue_forbidden,
                "rescue_blocked_by_claim_types": blocking_types,
                "below_threshold": below,
                "summary_chars": len(summary),
                "summary_preview": summary[:200] + ("…" if len(summary) > 200 else ""),
                "extracts_count": len(item_extracts),
                "extracts_total_chars": sum(len(e) for e in item_extracts),
                "extracts_combined_preview": combined[:200] + ("…" if len(combined) > 200 else ""),
            })
            if below:
                low_coherence.append(
                    f"{iid}: tfidf={round(tfidf, 3)}, contain={round(contain, 3)}"
                    + (f", emb={round(emb_cos, 3)}" if emb_cos is not None else "")
                )

        if not emb_enabled:
            emb_role = "disabled"
        elif emb_available_observed:
            emb_role = "rescue_signal"
        else:
            emb_role = "unavailable"

        coherence_details = {
            "tfidf_threshold": tfidf_threshold,
            "containment_threshold": contain_threshold,
            "verdict_logic": (
                "(tfidf < t1 AND contain < t2) AND NOT (embedding >= rescue)"
                if emb_role == "rescue_signal"
                else "AND (warn when both below)"
            ),
            "embedding_role": emb_role,
            "embedding_model": emb_model_name if emb_enabled else None,
            "embedding_rescue_threshold": emb_rescue_threshold if emb_enabled else None,
            "embedding_rescue_blocklist": sorted(rescue_blocklist),
            "rouge_l_role": "info_only" if rouge_l_scorer is not None else "unavailable",
            "scored_items": scored,
            "rescued_by_embedding_count": rescued_count,
            "below_threshold_count": len(low_coherence),
            "per_item": per_item_scores,
        }
        if low_coherence:
            rescue_note = (
                f" ({rescued_count} rescued by embedding ≥ {emb_rescue_threshold})"
                if rescued_count else ""
            )
            results.append(DeterministicCheck(
                check_id="summary_source_coherence",
                status="warning", severity="low",
                message=(
                    f"{len(low_coherence)} of {scored} item(s) below both "
                    f"tfidf {tfidf_threshold} AND containment {contain_threshold}"
                    f"{rescue_note}"
                ),
                route="annotate",
                offending="; ".join(low_coherence[:5]),
                details=coherence_details,
            ))
        else:
            rescue_note = (
                f" ({rescued_count} rescued by embedding)"
                if rescued_count else ""
            )
            results.append(DeterministicCheck(
                check_id="summary_source_coherence",
                status="pass", severity="info",
                message=(
                    f"All {scored} scored item(s) clear coherence floor "
                    f"(tfidf ≥ {tfidf_threshold} OR containment ≥ {contain_threshold}"
                    f"{rescue_note})"
                ),
                route="pass",
                details=coherence_details,
            ))

    # 9. completeness_floor — minimum-substance thresholds from spec.completeness.
    #    Warnings only; never blocks. Catches "agent shipped a skeleton."
    comp = spec.get("completeness") or {}
    if comp:
        comp_issues: list[str] = []
        comp_measured: dict = {}

        # priority items
        min_pri = comp.get("min_priority_items")
        comp_measured["priority_items"] = {
            "count": len(priority_items),
            "min": min_pri,
            "target": comp.get("target_priority_items"),
            "ids": [it.get("id") for it in priority_items],
        }
        if min_pri is not None and len(priority_items) < min_pri:
            comp_issues.append(f"only {len(priority_items)} priority item(s) (min {min_pri})")

        # executive summary length — WS2 decouple: walk spec-declared paths from
        # completeness.field_paths instead of hard-coded meeting_briefing field
        # names. lead_in_path + exec_summary_overview_paths feed the measurement.
        # Edge case (resolved): no overview paths declared → skip-with-warning,
        # never silent-skip.
        fpaths = comp.get("field_paths") or {}
        min_exec = comp.get("min_executive_summary_chars")
        lead_in_path = fpaths.get("lead_in_path")
        overview_paths = fpaths.get("exec_summary_overview_paths") or []
        lead_in_values = _values_at_path(artifact, lead_in_path) if lead_in_path else []
        lead_in_chars = sum(len(v) for v in lead_in_values)
        # Optional scope: when 'priority_filter', an items[]-rooted overview path
        # only counts entries that match priority_filter (e.g. tier==featured),
        # so queued/standard items can't inflate the exec-summary length.
        overview_scope = fpaths.get("exec_summary_overview_scope")
        priority_ids = {it.get("id") for it in priority_items}
        overview_values: list[str] = []
        for op in overview_paths:
            if overview_scope == "priority_filter" and op.startswith("items[]."):
                leaf = op[len("items[]."):]
                for it in items:
                    if not isinstance(it, dict) or it.get("id") not in priority_ids:
                        continue
                    v = _walk(it, leaf)
                    if isinstance(v, str) and v.strip():
                        overview_values.append(v)
            else:
                overview_values.extend(_values_at_path(artifact, op))
        overview_chars = sum(len(v) for v in overview_values)
        exec_len = lead_in_chars + overview_chars
        comp_measured["executive_summary"] = {
            "chars": exec_len,
            "lead_in_chars": lead_in_chars,
            "overview_chars": overview_chars,
            "lead_in_path": lead_in_path,
            "overview_paths": overview_paths,
            "overview_count": len(overview_values),
            "min": min_exec,
        }
        if not overview_paths:
            comp_issues.append(
                "executive_summary length not measured: no "
                "completeness.field_paths.exec_summary_overview_paths declared "
                "(skip-with-warning)"
            )
        elif not overview_values and priority_items:
            # Paths declared but resolve to nothing while featured items exist —
            # report as a missing/empty required field, not a length shortfall,
            # so it can't silently undercount (the prior MB silent-undercount bug).
            comp_issues.append(
                f"required exec-summary overview missing or empty at {overview_paths} "
                f"({len(priority_items)} featured item(s) present)"
            )
        elif min_exec is not None and exec_len < min_exec:
            comp_issues.append(f"executive_summary {exec_len} chars (min {min_exec})")

        # per-priority-item overview length — field name from spec.field_paths
        # (default 'summary' under each priority item's display).
        min_overview = comp.get("min_overview_chars_per_priority_item")
        pi_field = fpaths.get("priority_item_overview_field", "summary")
        per_item_overview = {
            it.get("id"): len((it.get("display") or {}).get(pi_field) or "")
            for it in priority_items
        }
        comp_measured["overview_chars_per_priority_item"] = {
            "per_item": per_item_overview,
            "min": min_overview,
        }
        if min_overview is not None:
            short = [iid for iid, n in per_item_overview.items() if n < min_overview]
            if short:
                comp_issues.append(
                    f"{len(short)} priority item(s) with overview < {min_overview} chars: {short[:3]}"
                )

        # total prose word count — WS2 decouple: accumulate prose from the
        # spec-declared total_prose_paths. Falls back to the exec lead+overview
        # paths when total_prose_paths is absent, so a partial spec still counts
        # something rather than silently scoring zero.
        min_words = comp.get("min_total_prose_words")
        total_prose_paths = fpaths.get("total_prose_paths")
        if not total_prose_paths:
            total_prose_paths = ([lead_in_path] if lead_in_path else []) + list(overview_paths)
        prose_parts: list[str] = []
        for pp in total_prose_paths:
            prose_parts.extend(_values_at_path(artifact, pp))
        total_words = sum(len(p.split()) for p in prose_parts)
        comp_measured["total_prose"] = {
            "words": total_words,
            "min": min_words,
            "parts_counted": len(prose_parts),
            "paths": total_prose_paths,
        }
        if min_words is not None and total_words < min_words:
            comp_issues.append(f"total prose ~{total_words} words (min {min_words})")

        if comp_issues:
            results.append(DeterministicCheck(
                check_id="completeness_floor",
                status="warning", severity="low",
                message=f"Completeness floor not met: {'; '.join(comp_issues)}",
                route="annotate",
                details=comp_measured,
            ))
        else:
            results.append(DeterministicCheck(
                check_id="completeness_floor",
                status="pass", severity="info",
                message="All completeness thresholds met",
                route="pass",
                details=comp_measured,
            ))

    # 10. polish_grammar — deterministic regex polish on EO-facing prose.
    #     Always annotation-level (never blocks). Per-finding path enables
    #     the calling agent to fix specific locations before final write.
    polish_patterns = spec.get("polish_patterns") or []
    if polish_patterns:
        polish_findings: list[dict] = []
        for path, text in _iter_polish_prose(artifact):
            for entry in polish_patterns:
                name = entry.get("name", "unnamed")
                pattern = entry.get("pattern", "")
                if not pattern:
                    continue
                flags = re.IGNORECASE if entry.get("case_insensitive") else 0
                for m in re.finditer(pattern, text, flags):
                    start = max(0, m.start() - 25)
                    end = min(len(text), m.end() + 25)
                    context = text[start:end].replace("\n", " ")
                    polish_findings.append({
                        "pattern_name": name,
                        "path": path,
                        "matched": m.group(0),
                        "context": ("…" if start > 0 else "") + context + ("…" if end < len(text) else ""),
                    })
        polish_details = {
            "patterns_checked": [p.get("name") for p in polish_patterns],
            "findings": polish_findings,
            "total_prose_fields_scanned": sum(1 for _ in _iter_polish_prose(artifact)),
        }
        if polish_findings:
            results.append(DeterministicCheck(
                check_id="polish_grammar",
                status="warning", severity="low",
                message=f"{len(polish_findings)} polish issue(s) in prose",
                route="annotate",
                offending="; ".join(
                    f"{f['pattern_name']}@{f['path']}: '{f['matched']}'"
                    for f in polish_findings[:5]
                ),
                details=polish_details,
            ))
        else:
            results.append(DeterministicCheck(
                check_id="polish_grammar",
                status="pass", severity="info",
                message="No polish issues found across EO-facing prose",
                route="pass",
                details=polish_details,
            ))

    return results


def _iter_polish_prose(artifact: dict):
    """Yield (path, text) for every EO-facing prose field worth polishing.

    Paths use a JSONPath-ish notation so a downstream agent can locate the
    exact field to fix. The fields enumerated here are the ones that render
    to the EO and PMs — audit fields (raw_context, source extracts) are NOT
    polished because they must remain verbatim.
    """
    exec_obj = artifact.get("executive_summary")
    if isinstance(exec_obj, dict):
        lead_in = exec_obj.get("lead_in")
        if isinstance(lead_in, str) and lead_in:
            yield ("$.executive_summary.lead_in", lead_in)
    for item in artifact.get("items") or []:
        iid = item.get("id") or "<no-id>"
        display = item.get("display") or {}
        if isinstance(display.get("summary"), str) and display["summary"]:
            yield (f"$.items[{iid}].display.summary", display["summary"])
        eso = display.get("executive_summary_overview")
        if isinstance(eso, str) and eso:
            yield (f"$.items[{iid}].display.executive_summary_overview", eso)
        bi = display.get("budget_impact")
        if bi and isinstance(bi.get("summary"), str) and bi["summary"]:
            yield (f"$.items[{iid}].display.budget_impact.summary", bi["summary"])
        cs = display.get("constituent_sentiment")
        if cs and isinstance(cs.get("summary"), str) and cs["summary"]:
            yield (f"$.items[{iid}].display.constituent_sentiment.summary", cs["summary"])
        for j, tp in enumerate(display.get("talking_points") or []):
            if isinstance(tp, str) and tp:
                yield (f"$.items[{iid}].display.talking_points[{j}]", tp)


# ── LLM clients ───────────────────────────────────────────────────────────────

class _AdjudicationOutput(BaseModel):
    accuracy_category: Literal[
        "Accurate",
        "Directionally Consistent",
        "Extrapolating",
        "Modeled",
        "Not in Source — Verified Elsewhere",
        "Not in Source — Unresolved",
        "Incorrect",
        "Unverifiable",
    ]
    reasoning: str
    proposed_correction: Optional[str] = None


_TRIAGE_SYSTEM = """You are a factual accuracy reviewer for civic briefing documents.

Given a factual claim and a source extract from a government agenda document, classify the claim's accuracy.

Categories:
- Accurate: The claim matches the source extract precisely.
- Directionally Consistent: The claim is generally aligned with the source but not verbatim.
- Extrapolating: The claim goes slightly beyond the source but is a reasonable inference from it.
- Modeled: The claim is explicitly based on modeled or estimated data (e.g., constituent sentiment scores).
- Not in Source — Verified Elsewhere: The claim cannot be found in this extract but may be correct from another source.
- Not in Source — Unresolved: The claim cannot be substantiated from the provided source.
- Incorrect: The claim contradicts the source extract.
- Unverifiable: The source exists but the claim cannot be verified against it as written.

Be direct. Do not hedge. If the extract is empty, classify as Not in Source — Unresolved."""


_ESCALATION_SYSTEM = """You are an adversarial fact-checker reviewing a civic briefing claim that a first-pass reviewer flagged as not adequately supported. Your default posture is skepticism: assume the first reviewer was generous, and look hard for what they may have missed.

Procedure:
1. Read the claim and identify every factual assertion within it (numbers, names, dates, vote counts, recommendations, attributions). Each assertion must be independently grounded in the source passage.
2. For every assertion, find the supporting span in the source passage. Quote it back to yourself before classifying.
3. If any assertion is unsupported, partially supported, or contradicted by the source — even if other assertions are fine — the overall claim does not get a clean pass.
4. Do not defer to the first reviewer. Do not give the briefing the benefit of the doubt. If you cannot independently confirm the claim, classify accordingly.

You receive context in three labeled tiers:
- PRIMARY: the agent's stated grounding (cited extracts with their section_header). This is where the agent says the evidence is.
- SECONDARY: full snapshots of the cited sources. Use to verify the cited extracts are faithful and not cherry-picked.
- TERTIARY: the rest of the agenda packet (uncited sources). Use to find grounding the agent may have missed — a claim is not necessarily wrong if it can be substantiated elsewhere in the packet, but you should call out the missing citation.

Apply the same accuracy categories as the first reviewer.

Categories:
- Accurate: Every assertion in the claim is directly and verifiably grounded in the source passage.
- Directionally Consistent: Generally aligned with the source but not verbatim on the specifics.
- Extrapolating: Reasonable inference from the source, but extends beyond what the source explicitly states.
- Modeled: Explicitly framed as modeled/estimated data; the framing itself is accurate.
- Not in Source — Verified Elsewhere: The claim cannot be confirmed from this passage but may be correct from another source (use this when grounding lives in TERTIARY rather than the cited sources).
- Not in Source — Unresolved: The claim cannot be substantiated by the passage.
- Incorrect: The claim contradicts the source passage.
- Unverifiable: The passage exists but cannot be assessed as supporting or refuting the claim as written.

When you classify as anything other than Accurate, Directionally Consistent, Extrapolating, or Modeled, you MUST populate `proposed_correction` with a specific, actionable fix. Take one of these shapes:
- A rewritten claim text grounded in the source as you understand it. Be specific about which phrases to change and which to keep.
- A removal recommendation if no source in the packet supports the claim.
- A scope tightening if part of the claim is grounded but another part is not — restrict the claim to what is supported and drop the rest.

If your verdict is Accurate, Directionally Consistent, Extrapolating, or Modeled, leave `proposed_correction` as null."""


def _format_phase1_user_prompt(claim: dict) -> str:
    """Build Phase 1 context: ALL source_extracts as a labeled list.

    A single claim may be grounded across multiple separately-cited extracts (e.g. a
    table caption + a table row). Phase 1 sees them all so the judge can verify each
    assertion in the claim against whichever extract supports it.

    Each extract may carry a section_header (object-form extracts) — the header is what
    gives the verbatim text its context. A bare table row only makes sense once you know
    the table's caption. We render section_header alongside the text so the judge can
    reason about both.
    """
    extracts = [e for e in (claim.get("source_extracts") or []) if _extract_text(e).strip()]
    if not extracts:
        return "Source extracts: (none provided by the agent — claim is unsupported by design)"

    def _render(idx: int, ex) -> list[str]:
        text = _extract_text(ex)
        header = _extract_section_header(ex)
        kind = _extract_type(ex)
        lines = [f"[Extract {idx}]"]
        if header:
            lines.append(f"Section: {header}")
        if kind != "unknown":
            lines.append(f"Type: {kind}")
        if header or kind != "unknown":
            lines.append("Text:")
        lines.append(text)
        return lines

    if len(extracts) == 1:
        parts = ["Source extract (one provided):"]
        parts.extend(_render(1, extracts[0]))
        return "\n".join(parts)

    parts = [
        f"Source extracts ({len(extracts)} provided, listed separately — each was cited "
        f"verbatim by the agent; any may be the relevant one for a given assertion in the claim).",
        "",
    ]
    for i, ex in enumerate(extracts, 1):
        parts.extend(_render(i, ex))
        parts.append("")
    return "\n".join(parts).rstrip()


_PHASE2_PER_SOURCE_CAP = 5000
_PHASE2_TOTAL_PACKET_CAP = 50000


def _format_phase2_user_prompt(claim: dict, sources: list[dict], artifact: dict) -> str:
    """Build Phase 2 context for adversarial review:

    PRIMARY  — the claim's stated grounding: each cited extract with its section_header
               (the agent's claimed evidence). Focus verification here first.
    SECONDARY — full retrieved_text_or_snapshot for each cited source, capped per-source.
                Verify whether the cited extracts are faithful and complete.
    TERTIARY  — the full agenda packet: every source's snapshot in sources[], regardless
                of whether the claim cited it. Use to find grounding the agent may have
                missed or to confirm a date/fact lives in a different uncited source.
    """
    source_map = {s["id"]: s for s in (sources or []) if s.get("id")}
    cited_ids = list(claim.get("source_ids") or [])
    cited_set = set(cited_ids)
    extracts = [e for e in (claim.get("source_extracts") or []) if _extract_text(e).strip()]

    parts: list[str] = []

    parts.append("== Stated grounding for this claim (PRIMARY — focus your verification here) ==")
    if extracts:
        parts.append(
            f"The briefing agent cited {len(extracts)} extract(s) verbatim from the source(s). "
            f"Each carries the verbatim text plus a section_header naming where in the source it came from."
        )
        parts.append("")
        for i, ex in enumerate(extracts, 1):
            parts.append(f"[Extract {i}]")
            header = _extract_section_header(ex)
            kind = _extract_type(ex)
            if header:
                parts.append(f"Section: {header}")
            if kind != "unknown":
                parts.append(f"Type: {kind}")
            parts.append("Text:")
            parts.append(_extract_text(ex))
            parts.append("")
    else:
        parts.append("(no extracts provided)")
        parts.append("")

    parts.append(
        "== Full snapshots of cited sources "
        "(SECONDARY — verify whether the cited extracts above are faithful and complete) =="
    )
    for sid in cited_ids:
        src = source_map.get(sid)
        if not src:
            parts.append(f"[Source {sid}] (source_id does not resolve in sources[])")
            parts.append("")
            continue
        snapshot = src.get("retrieved_text_or_snapshot", "") or ""
        if not snapshot:
            parts.append(f"[Source {sid} — {src.get('source_type', 'unknown')}] (no snapshot captured)")
            parts.append("")
            continue
        truncated = snapshot[:_PHASE2_PER_SOURCE_CAP]
        parts.append(f"[Source {sid} — {src.get('source_type', 'unknown')}]")
        parts.append(truncated)
        if len(snapshot) > _PHASE2_PER_SOURCE_CAP:
            parts.append("…(snapshot truncated)")
        parts.append("")

    parts.append(
        "== Full agenda packet "
        "(TERTIARY — every source in the artifact, cited or not; use to find grounding "
        "the agent may have missed or to triangulate facts across sources) =="
    )
    packet_budget = _PHASE2_TOTAL_PACKET_CAP
    for src in (sources or []):
        sid = src.get("id")
        if not sid or sid in cited_set:
            continue  # cited ones already in SECONDARY
        snapshot = src.get("retrieved_text_or_snapshot", "") or ""
        if not snapshot:
            parts.append(f"[Source {sid} — {src.get('source_type', 'unknown')}] (no snapshot captured)")
            parts.append("")
            continue
        if packet_budget <= 0:
            parts.append("…(remaining sources omitted; total packet cap reached)")
            break
        share = min(_PHASE2_PER_SOURCE_CAP, packet_budget)
        truncated = snapshot[:share]
        parts.append(f"[Source {sid} — {src.get('source_type', 'unknown')}]")
        parts.append(truncated)
        if len(snapshot) > share:
            parts.append("…(snapshot truncated)")
        parts.append("")
        packet_budget -= len(truncated)

    return "\n".join(parts).rstrip()


def _response_schema_instruction() -> str:
    """Generic JSON-output instruction usable by any LLM provider.

    Built from the _AdjudicationOutput Pydantic schema so adding/removing fields
    propagates without prompt edits across multiple judge implementations. New
    judges (OpenAI, DeepSeek, Bedrock, etc.) reuse this helper for parity.
    """
    schema = _AdjudicationOutput.model_json_schema()
    return (
        "Respond with a single JSON object matching this schema:\n"
        + json.dumps(schema, indent=2)
        + "\n\nReturn JSON only — no surrounding prose, no markdown fencing."
    )


class Judge:
    """Pluggable LLM judge for QA adjudication. Subclasses implement provider-specific clients.

    A Judge is configured by a single entry in the QA_JUDGES env var, of the form
    `name:provider:model` (e.g. `claude:anthropic:claude-sonnet-4-6`). The product_spec
    declares which named judge each Phase uses (`spec.judges.phase1`, `spec.judges.phase2`).
    """

    def __init__(self, name: str, provider: str, model: str, api_key: str):
        self.name = name
        self.provider = provider
        self.model = model
        self.api_key = api_key

    def adjudicate(
        self,
        claim: dict,
        system_prompt: str,
        source_passage: str = "",
        prior: Optional[Phase1Result] = None,
    ) -> _AdjudicationOutput:
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name={self.name!r}, provider={self.provider!r}, model={self.model!r})"


class AnthropicJudge(Judge):
    def adjudicate(
        self,
        claim: dict,
        system_prompt: str,
        source_passage: str = "",
        prior: Optional[Phase1Result] = None,
    ) -> _AdjudicationOutput:
        import anthropic
        client = anthropic.Anthropic(api_key=self.api_key)

        tool_def = {
            "name": "classify",
            "description": "Classify claim accuracy",
            "input_schema": _AdjudicationOutput.model_json_schema(),
        }
        prompt_lines = [
            f"Claim: {claim.get('claim_text', '')}",
            f"Claim type: {claim.get('claim_type', 'unknown')}",
            "",
            source_passage or "(no context provided)",
        ]
        if prior is not None:
            prompt_lines.append("")
            prompt_lines.append(f"First reviewer verdict: {prior.accuracy_category}")
            prompt_lines.append(f"First reviewer reasoning: {prior.reasoning}")

        resp = client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=system_prompt,
            tools=[tool_def],
            tool_choice={"type": "tool", "name": "classify"},
            messages=[{"role": "user", "content": "\n".join(prompt_lines)}],
        )
        block = next((b for b in resp.content if b.type == "tool_use"), None)
        if block is None:
            raise RuntimeError("No tool_use block from Anthropic")
        return _AdjudicationOutput.model_validate(block.input)


class GoogleJudge(Judge):
    def adjudicate(
        self,
        claim: dict,
        system_prompt: str,
        source_passage: str = "",
        prior: Optional[Phase1Result] = None,
    ) -> _AdjudicationOutput:
        import google.generativeai as genai
        genai.configure(api_key=self.api_key)
        model = genai.GenerativeModel(self.model)

        prompt_lines = [
            system_prompt,
            "",
            f"Claim: {claim.get('claim_text', '')}",
            f"Claim type: {claim.get('claim_type', 'unknown')}",
            "",
            source_passage or "(no context provided)",
        ]
        if prior is not None:
            prompt_lines.append("")
            prompt_lines.append(f"First reviewer verdict: {prior.accuracy_category}")
            prompt_lines.append(f"First reviewer reasoning: {prior.reasoning}")
        prompt_lines.append("")
        prompt_lines.append(_response_schema_instruction())

        resp = model.generate_content("\n\n".join(prompt_lines))
        raw = resp.text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        try:
            data = json.loads(raw)
            return _AdjudicationOutput.model_validate(data)
        except Exception:
            # Best-effort regex fallback when the model produces malformed JSON
            cat_match = re.search(r'"accuracy_category"\s*:\s*"([^"]+)"', raw)
            reason_match = re.search(r'"reasoning"\s*:\s*"([^"]+)"', raw)
            corr_match = re.search(r'"proposed_correction"\s*:\s*"([^"]+)"', raw)
            return _AdjudicationOutput(
                accuracy_category=cat_match.group(1) if cat_match else "Unverifiable",
                reasoning=reason_match.group(1) if reason_match else "Could not parse response",
                proposed_correction=corr_match.group(1) if corr_match else None,
            )


PROVIDER_REGISTRY: dict[str, type[Judge]] = {
    "anthropic": AnthropicJudge,
    "google": GoogleJudge,
}


def parse_qa_judges(env_value: str) -> list[dict]:
    """Parse QA_JUDGES env var into a list of {name, provider, model} dicts.

    Format: `name:provider:model,name:provider:model,...`
    Example: `claude:anthropic:claude-sonnet-4-6,gemini:google:gemini-2.5-flash`
    """
    if not env_value:
        return []
    out: list[dict] = []
    for chunk in env_value.split(","):
        parts = chunk.strip().split(":")
        if len(parts) != 3:
            continue
        out.append({
            "name": parts[0].strip(),
            "provider": parts[1].strip(),
            "model": parts[2].strip(),
        })
    return out


def _resolve_api_key(provider: str) -> Optional[str]:
    """Map provider → API key from environment. Supports non-standard env var names."""
    if provider == "anthropic":
        return os.environ.get("ANTHROPIC_API_KEY")
    if provider == "google":
        # gemini-qa-agent is the literal lowercase-hyphenated name in ~/Research/.env
        return (
            os.environ.get("gemini-qa-agent")
            or os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
        )
    if provider == "openai":
        return os.environ.get("OPEN_AI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    return None


def make_judge(name: str, judges_config: list[dict]) -> Optional[Judge]:
    """Instantiate the named judge using the QA_JUDGES-parsed config.

    Returns None when: name not present in config, provider unknown, or
    API key for the provider is not available. Caller is responsible
    for handling None (skip the phase, emit a status note).
    """
    for cfg in judges_config:
        if cfg.get("name") != name:
            continue
        provider = cfg.get("provider", "")
        cls = PROVIDER_REGISTRY.get(provider)
        if cls is None:
            return None
        api_key = _resolve_api_key(provider)
        if not api_key:
            return None
        return cls(name=cfg["name"], provider=provider, model=cfg["model"], api_key=api_key)
    return None


# ── Phase 1 — triage (Anthropic, all claims) ─────────────────────────────────

def phase1_triage(claims: list[dict], judge: Judge, ok_cats: set[str]) -> list[Phase1Result]:
    results: list[Phase1Result] = []
    for i, claim in enumerate(claims):
        cid = claim.get("claim_id", f"claim_{i}")
        try:
            user_context = _format_phase1_user_prompt(claim)
            out = judge.adjudicate(claim, system_prompt=_TRIAGE_SYSTEM, source_passage=user_context)
            results.append(Phase1Result(
                claim_id=cid,
                accuracy_category=out.accuracy_category,
                reasoning=out.reasoning,
                is_ok=out.accuracy_category in ok_cats,
            ))
        except Exception as e:
            results.append(Phase1Result(
                claim_id=cid,
                accuracy_category="Unverifiable",
                reasoning=f"Phase 1 adjudication failed ({judge.name}): {e}",
                is_ok=False,
            ))
    return results


# ── Phase 2 — escalation (Gemini, high-weight Phase-1-not-OK only) ────────────

def phase2_escalate(
    traces: list[ClaimTrace],
    sources: list[dict],
    judge: Judge,
    blockable: set[str],
    ok_cats: set[str],
    artifact: dict,
) -> None:
    """Mutates traces in-place, adding phase2 result for escalated claims.

    Phase 2 context includes (a) every cited extract, (b) full snapshots of every cited
    source, (c) the full briefing (exec summary + each item's display). Section labels
    in the prompt signal that cited locations are the primary focus and briefing-wide
    context is for triangulation only.
    """
    for trace in traces:
        claim = trace.claim
        p1 = trace.phase1
        if p1 is None or p1.is_ok:
            continue
        if claim.get("claim_type") not in blockable and claim.get("claim_weight") != "high":
            continue

        user_context = _format_phase2_user_prompt(claim, sources, artifact)

        try:
            out = judge.adjudicate(
                claim,
                system_prompt=_ESCALATION_SYSTEM,
                source_passage=user_context,
                prior=p1,
            )
            trace.phase2 = Phase2Result(
                claim_id=claim.get("claim_id", ""),
                accuracy_category=out.accuracy_category,
                reasoning=out.reasoning,
                is_ok=out.accuracy_category in ok_cats,
                proposed_correction=out.proposed_correction,
            )
        except Exception as e:
            trace.phase2 = Phase2Result(
                claim_id=claim.get("claim_id", ""),
                accuracy_category="Unverifiable",
                reasoning=f"Phase 2 adjudication failed ({judge.name}): {e}",
                is_ok=False,
                proposed_correction=None,
            )


# ── Routing ───────────────────────────────────────────────────────────────────

def route(
    det_checks: list[DeterministicCheck],
    traces: list[ClaimTrace],
    blockable: set[str],
) -> tuple[str, str]:
    """Return (status, reason) — 'Block' or 'OK'."""
    for chk in det_checks:
        if chk.route == "block" and chk.status == "fail":
            return "Block", f"Deterministic check failed: {chk.check_id} — {chk.message}"

    for trace in traces:
        claim = trace.claim
        if claim.get("claim_type") not in blockable and claim.get("claim_weight") != "high":
            continue
        if trace.phase2 is not None and not trace.phase2.is_ok:
            return (
                "Block",
                f"High-weight claim {claim.get('claim_id')} not supported after Phase 2 review "
                f"({trace.phase2.accuracy_category}): {trace.phase2.reasoning}"
            )

    return "OK", "All deterministic checks passed and no blockable claim failed Phase 2"


def compute_release_verdict(
    det_checks: list[DeterministicCheck],
    traces: list[ClaimTrace],
) -> str:
    """Three-way verdict for downstream consumers: 'ok' | 'warn' | 'block'.

    During the trial period, qa_validate.py reports the verdict but does not
    enforce it (default exit 0). Downstream callers (the agent invoking
    qa_validate.py, the Fargate runner) read this field and decide whether
    to act on it.
    """
    # block: any blocking deterministic failure OR any blockable/high-weight phase2 not-OK
    for chk in det_checks:
        if chk.route == "block" and chk.status == "fail":
            return "block"
    for trace in traces:
        if trace.phase2 is not None and not trace.phase2.is_ok:
            return "block"

    # warn: any annotation-level finding OR any phase1 not-OK
    for chk in det_checks:
        if chk.route == "annotate" and chk.status in ("fail", "warning"):
            return "warn"
    for trace in traces:
        if trace.phase1 is not None and not trace.phase1.is_ok:
            return "warn"

    return "ok"


# ── Output ────────────────────────────────────────────────────────────────────

def write_bundle(
    bundle_path: Path,
    artifact: dict,
    spec: dict,
    det_checks: list[DeterministicCheck],
    traces: list[ClaimTrace],
    status: str,
    reason: str,
    release_verdict: str,
    judges_used: dict,
    run_ts: str,
) -> Path:
    # Build a product_id from spec.product_id_template, substituting artifact fields.
    template = spec.get("product_id_template") or "{briefing_type}"
    raw_id = _format_safe(template, artifact)
    product_id = raw_id.lower().replace(" ", "_")

    bundle = {
        "product_id": product_id,
        "briefing_type": artifact.get("briefing_type") or spec.get("product_type") or "unknown",
        "release_verdict": release_verdict,
        "judges_used": judges_used,
        "run_timestamp": run_ts,
        "final_status": status,
        "block_reason": reason if status == "Block" else None,
        "deterministic_checks": [
            {
                "check_id": c.check_id,
                "status": c.status,
                "severity": c.severity,
                "message": c.message,
                "route": c.route,
                "offending": c.offending or None,
                "details": c.details,
            }
            for c in det_checks
        ],
        "claims": [
            {
                **trace.claim,
                "phase1": {
                    "accuracy_category": trace.phase1.accuracy_category,
                    "reasoning": trace.phase1.reasoning,
                    "is_ok": trace.phase1.is_ok,
                } if trace.phase1 else None,
                "phase2": {
                    "accuracy_category": trace.phase2.accuracy_category,
                    "reasoning": trace.phase2.reasoning,
                    "is_ok": trace.phase2.is_ok,
                    "proposed_correction": trace.phase2.proposed_correction,
                } if trace.phase2 else None,
                "final_route": trace.final_route,
            }
            for trace in traces
        ],
    }

    bundle_path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False))
    return bundle_path


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "artifact",
        type=Path,
        help="Path to the artifact JSON (qa-spine-compliant shape)",
    )
    parser.add_argument(
        "--product-spec",
        default="",
        help="Path to product spec JSON (default: meeting_briefing_product_spec.json)",
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Run deterministic checks only, skip LLM adjudication",
    )
    parser.add_argument(
        "--bundle-out",
        default="",
        help="Path to write qa_bundle.json (default: <artifact_dir>/qa_bundle.json)",
    )
    parser.add_argument(
        "--enforce-verdict",
        action="store_true",
        help=(
            "Exit non-zero when release_verdict != 'ok' (1 on warn, 2 on block). "
            "Default is non-blocking — script always exits 0 so callers can read "
            "the verdict from qa_bundle.json and decide policy themselves."
        ),
    )
    args = parser.parse_args()

    _load_env()

    spec_path = Path(args.product_spec) if args.product_spec else None
    spec = load_product_spec(spec_path)
    blockable = blockable_types(spec)
    ok_cats = ok_categories(spec)

    # Parse QA_JUDGES env var → list of {name, provider, model}
    judges_config = parse_qa_judges(os.environ.get("QA_JUDGES", ""))
    judges_spec = spec.get("judges") or {}
    judges_used: dict[str, Optional[dict]] = {"phase1": None, "phase2": None}

    run_ts = datetime.now(timezone.utc).isoformat()
    bundle_path = Path(args.bundle_out) if args.bundle_out else args.artifact.parent / "qa_bundle.json"

    print(f"\n{'=' * 60}")
    print(f"QA VALIDATION — {args.artifact}")
    print(f"{'=' * 60}")

    # 1. Load artifact
    print("\n[1/4] Load artifact...")
    artifact, load_checks = load_artifact(args.artifact)
    if any(c.route == "block" and c.status == "fail" for c in load_checks):
        write_bundle(
            bundle_path, {}, spec, load_checks, [],
            "Block", "Artifact not loadable",
            release_verdict="block", judges_used=judges_used, run_ts=run_ts,
        )
        print("  HALT: Artifact not loadable")
        print(f"\nrelease_verdict: block (non-blocking exit unless --enforce-verdict)")
        sys.exit(2 if args.enforce_verdict else 0)

    claims = artifact.get("claims") or []
    sources = artifact.get("sources") or []
    print(f"  Loaded: {len(artifact.get('items') or [])} item(s), "
          f"{len(claims)} claim(s), {len(sources)} source(s)")

    # 2. Deterministic
    print("[2/4] Deterministic checks...")
    det_checks = load_checks + run_deterministic(artifact, spec)
    det_fails = [c for c in det_checks if c.status == "fail"]
    det_warns = [c for c in det_checks if c.status == "warning"]
    print(f"  {len(det_fails)} failures, {len(det_warns)} warnings")

    traces = [ClaimTrace(claim=c) for c in claims]

    # 3. Phase 1 — adjudicate every claim with the spec-declared judge
    p1_name = judges_spec.get("phase1") or ""
    if not args.no_llm and claims and p1_name:
        p1_judge = make_judge(p1_name, judges_config)
        if p1_judge is None:
            print(f"[3/4] Phase 1 skipped — judge '{p1_name}' unavailable "
                  f"(check QA_JUDGES env and provider API key)")
        else:
            print(f"[3/4] Phase 1 triage — {len(claims)} claims via {p1_judge}")
            judges_used["phase1"] = {
                "name": p1_judge.name, "provider": p1_judge.provider, "model": p1_judge.model,
            }
            p1_results = phase1_triage(claims, p1_judge, ok_cats)
            p1_map = {r.claim_id: r for r in p1_results}
            for trace in traces:
                trace.phase1 = p1_map.get(trace.claim.get("claim_id", ""))
            not_ok = sum(1 for r in p1_results if not r.is_ok)
            print(f"  Phase 1 done: {not_ok}/{len(p1_results)} claims not-OK")
    else:
        reason = "--no-llm" if args.no_llm else ("no claims" if not claims else "no judge in spec.judges.phase1")
        print(f"[3/4] Phase 1 skipped ({reason})")

    # 4. Phase 2 — escalate high-weight Phase-1-not-OK
    high_not_ok = [
        t for t in traces
        if t.phase1 and not t.phase1.is_ok
        and (t.claim.get("claim_type") in blockable or t.claim.get("claim_weight") == "high")
    ]
    p2_name = judges_spec.get("phase2") or ""
    if not args.no_llm and high_not_ok and p2_name:
        p2_judge = make_judge(p2_name, judges_config)
        if p2_judge is None:
            print(f"[4/4] Phase 2 skipped — judge '{p2_name}' unavailable "
                  f"({len(high_not_ok)} claims need escalation)")
        else:
            print(f"[4/4] Phase 2 escalation — {len(high_not_ok)} high-weight not-OK via {p2_judge}")
            judges_used["phase2"] = {
                "name": p2_judge.name, "provider": p2_judge.provider, "model": p2_judge.model,
            }
            phase2_escalate(traces, sources, p2_judge, blockable, ok_cats, artifact)
            blocked = sum(1 for t in traces if t.phase2 and not t.phase2.is_ok)
            print(f"  Phase 2 done: {blocked}/{len(high_not_ok)} claims still not-OK after escalation")
    else:
        if args.no_llm:
            reason = "--no-llm"
        elif not high_not_ok:
            reason = "no high-weight not-OK claims"
        else:
            reason = "no judge in spec.judges.phase2"
        print(f"[4/4] Phase 2 skipped ({reason})")

    # Assign final_route per claim
    for trace in traces:
        claim = trace.claim
        ctype = claim.get("claim_type", "")
        is_blockable = ctype in blockable or claim.get("claim_weight") == "high"
        if trace.phase2 is not None and not trace.phase2.is_ok and is_blockable:
            trace.final_route = "block"
        elif trace.phase1 is not None and not trace.phase1.is_ok:
            trace.final_route = "annotate"
        else:
            trace.final_route = "ok"

    # 5. Route + release_verdict
    status, reason = route(det_checks, traces, blockable)
    release_verdict = compute_release_verdict(det_checks, traces)

    # 6. Write
    write_bundle(
        bundle_path, artifact, spec, det_checks, traces,
        status, reason,
        release_verdict=release_verdict, judges_used=judges_used, run_ts=run_ts,
    )

    # Summary
    print(f"\n{'=' * 60}")
    print(f"release_verdict: {release_verdict.upper()}")
    if status == "Block":
        print(f"Block reason: {reason}")
    blocked_claims = sum(1 for t in traces if t.final_route == "block")
    annotated_claims = sum(1 for t in traces if t.final_route == "annotate")
    print(f"Claims: {len(traces)} total — {blocked_claims} blocked, {annotated_claims} annotated")
    det_block_count = sum(1 for c in det_checks if c.route == "block" and c.status == "fail")
    det_warn_count = sum(1 for c in det_checks if c.status in ("fail", "warning") and c.route == "annotate")
    print(f"Deterministic: {det_block_count} block-level, {det_warn_count} annotation-level")
    print(f"\nFull trace: {bundle_path}")

    if args.enforce_verdict:
        sys.exit({"ok": 0, "warn": 1, "block": 2}[release_verdict])
    sys.exit(0)


if __name__ == "__main__":
    main()
