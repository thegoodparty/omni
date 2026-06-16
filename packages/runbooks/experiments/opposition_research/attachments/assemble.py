import json
import os
import sys
import unicodedata

_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "esq"}


def _normalize_name(name):
    # Match the instruction's fuzzy rule: case-fold, strip accents, drop
    # middle initials (single-letter tokens) and common suffixes. So a roster
    # "María A. Sánchez Jr." matches a candidate_name of "Maria Sanchez".
    ascii_name = (
        unicodedata.normalize("NFKD", name)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    # Treat hyphens as separators so "María-José" matches "Maria Jose".
    tokens = [
        t
        for t in ascii_name.lower().replace("-", " ").split()
        if len(t.rstrip(".")) > 1 and t.rstrip(".") not in _NAME_SUFFIXES
    ]
    return " ".join(tokens)


def _workspace():
    return os.environ.get("ASSEMBLE_WORKSPACE", "/workspace")


def _load_params():
    raw = os.environ.get("PARAMS_JSON", "{}")
    try:
        params = json.loads(raw)
    except (ValueError, TypeError):
        params = {}
    return params if isinstance(params, dict) else {}


def _load_race(scratch_dir):
    # partisan_type (+ optional candidate_name) derived by the agent in Step 0.
    # The input contract nests the race under campaign_strategy_context, so the
    # agent writes the bits the assembler needs here. Returns None only when the
    # file is missing/unreadable, so an explicit empty {} the agent wrote is
    # used as-is rather than silently falling back to PARAMS_JSON.
    path = os.path.join(scratch_dir, "_race.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (ValueError, OSError):
        return None
    return data if isinstance(data, dict) else None


def _load_opponents(scratch_dir):
    # The agent writes the full confirmed opponent list (seed roster + any
    # web-confirmed late filers, candidate excluded) to a single file. No
    # per-opponent fan-out, no research fragments.
    path = os.path.join(scratch_dir, "opponents.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (ValueError, OSError):
        return []
    if not isinstance(data, list):
        sys.stderr.write(f"warning: {path} is not a JSON array\n")
        return []
    out = []
    seen_names = set()
    for item in data:
        if not isinstance(item, dict):
            sys.stderr.write("warning: skipping non-object opponent entry\n")
            continue
        name = item.get("full_name")
        if not isinstance(name, str) or not name.strip():
            sys.stderr.write("warning: skipping opponent without a full_name\n")
            continue
        # Dedup by normalized name: the same person can legitimately appear in
        # both the general and primary rosters (the agent folds primary into
        # the seed list), and must not be published twice.
        norm = _normalize_name(name)
        if norm in seen_names:
            sys.stderr.write(f"warning: skipping duplicate opponent '{name}'\n")
            continue
        seen_names.add(norm)
        out.append(item)
    return out


_INCUMBENT = {"yes": True, "no": False, "unknown": None}


def _incumbent(value):
    # Accept the "Yes" / "No" / "Unknown" strings the instruction asks for, and
    # also a raw boolean / null straight from the roster's is_incumbent.
    if value is True or value is False or value is None:
        return value
    return _INCUMBENT.get(str(value).strip().lower())


def _party_affiliation(party, partisan_type):
    # Nonpartisan race -> the party labels are registration noise, not the
    # contest, so normalize to "Nonpartisan". Otherwise the opponent's party,
    # or "Unknown".
    if str(partisan_type or "").strip().lower() == "nonpartisan":
        return "Nonpartisan"
    if party:
        return party
    return "Unknown"


def _to_opponent(frag, partisan_type):
    return {
        "full_name": frag.get("full_name"),
        "party_affiliation": _party_affiliation(frag.get("party"), partisan_type),
        "incumbent": _incumbent(frag.get("incumbent")),
    }


def _build_artifact(race, opponents):
    partisan_type = race.get("partisan_type")
    return {"opponents": [_to_opponent(o, partisan_type) for o in opponents]}


def _spot_checks(artifact, race):
    reasons = []
    candidate_name = race.get("candidate_name")
    if isinstance(candidate_name, str) and candidate_name.strip():
        norm_candidate = _normalize_name(candidate_name)
        for opp in artifact["opponents"]:
            name = opp.get("full_name")
            if isinstance(name, str) and _normalize_name(name) == norm_candidate:
                reasons.append(
                    f"candidate '{candidate_name}' appears as an opponent"
                )
                break
    return reasons


def _validate_shape(workspace, artifact):
    schema_path = os.path.join(workspace, "contract_schema.json")
    if not os.path.exists(schema_path):
        return []
    try:
        with open(schema_path, "r", encoding="utf-8") as fh:
            schema = json.load(fh)
    except (ValueError, OSError) as exc:
        sys.stderr.write(f"warning: could not read contract_schema.json: {exc}\n")
        return []
    try:
        import jsonschema

        jsonschema.validate(instance=artifact, schema=schema)
        return []
    except ImportError:
        return [] if "opponents" in artifact else ["artifact missing 'opponents'"]
    except jsonschema.ValidationError as exc:
        return [f"artifact schema violation: {exc.message}"]
    except jsonschema.SchemaError as exc:
        sys.stderr.write(
            f"warning: contract_schema.json is not a valid JSON Schema: {exc}\n"
        )
        return [] if "opponents" in artifact else ["artifact missing 'opponents'"]


def main():
    workspace = _workspace()
    scratch_dir = os.path.join(workspace, "scratch")
    output_dir = os.path.join(workspace, "output")
    os.makedirs(output_dir, exist_ok=True)

    # Prefer the agent's derived race fields (_race.json); fall back to PARAMS
    # for older callers / tests that pass them top-level. Only fall back when
    # the file is absent (None) — an explicit {} the agent wrote is used as-is.
    race = _load_race(scratch_dir)
    if race is None:
        race = _load_params()
    opponents = _load_opponents(scratch_dir)

    artifact = _build_artifact(race, opponents)

    # Validate before writing so a known-bad artifact never lands in the
    # published output dir.
    reasons = _spot_checks(artifact, race)
    reasons += _validate_shape(workspace, artifact)

    if reasons:
        print("FAIL: " + "; ".join(reasons))
        sys.exit(1)

    output_path = os.path.join(output_dir, "opposition_research.json")
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, indent=2, ensure_ascii=False)
    print("PASS")
    sys.exit(0)


if __name__ == "__main__":
    main()
