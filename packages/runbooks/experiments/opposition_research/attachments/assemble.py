import glob
import json
import os
import sys
from datetime import date, datetime, timezone


def _workspace():
    return os.environ.get("ASSEMBLE_WORKSPACE", "/workspace")


def _load_params():
    raw = os.environ.get("PARAMS_JSON", "{}")
    try:
        params = json.loads(raw)
    except (ValueError, TypeError):
        params = {}
    if not isinstance(params, dict):
        params = {}
    return params


def _load_fragments(scratch_dir):
    fragments = []
    paths = sorted(glob.glob(os.path.join(scratch_dir, "opp_*.json")))
    for path in paths:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (ValueError, OSError) as exc:
            sys.stderr.write(f"warning: skipping {path}: {exc}\n")
            continue
        if not isinstance(data, dict):
            sys.stderr.write(
                f"warning: skipping {path}: not a JSON object\n"
            )
            continue
        fragments.append(data)
    return fragments


def _load_closing_note(scratch_dir):
    path = os.path.join(scratch_dir, "_closing_note.txt")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError as exc:
        sys.stderr.write(f"warning: could not read closing note: {exc}\n")
        return None


def _build_markdown(fragments, closing_note):
    header = "### Opposition Research\n\n"
    if not fragments:
        today = date.today().isoformat()
        return (
            header
            + f"No opponents are currently registered for this race as of {today}. "
            + "Continue to monitor, since filing windows may still be open."
        )
    blocks = [str(frag.get("markdown_block") or "") for frag in fragments]
    body = "\n\n".join(blocks)
    markdown = header + body
    if closing_note:
        markdown = markdown + "\n\n" + closing_note
    return markdown


def _build_opponents(fragments):
    opponents = []
    for frag in fragments:
        opp = {k: v for k, v in frag.items() if k != "markdown_block"}
        opponents.append(opp)
    return opponents


def _build_artifact(params, fragments, closing_note):
    return {
        "markdown": _build_markdown(fragments, closing_note),
        "opponents": _build_opponents(fragments),
        "race": {
            "office_name": params.get("office_name"),
            "state": params.get("state"),
            "partisanType": params.get("partisanType"),
            "opponent_count": len(fragments),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _spot_checks(artifact, params):
    reasons = []
    markdown = artifact["markdown"]

    candidate_name = params.get("candidate_name")
    if isinstance(candidate_name, str) and candidate_name.strip():
        if candidate_name.lower() in markdown.lower():
            reasons.append(
                f"candidate name '{candidate_name}' appears in markdown"
            )

    if "—" in markdown:
        reasons.append("em dash (U+2014) present in markdown")

    count = artifact["race"]["opponent_count"]
    n_opp = len(artifact["opponents"])
    if count != n_opp:
        reasons.append(
            f"opponent_count {count} does not match opponents length {n_opp}"
        )

    if params.get("partisanType") == "nonpartisan":
        allowed = "Party affiliation: Nonpartisan (race is nonpartisan)"
        for line in markdown.splitlines():
            content = line.strip().lstrip("-").strip()
            if "Party affiliation:" in content and content != allowed:
                reasons.append(
                    f"nonpartisan race has non-nonpartisan party line: '{content}'"
                )
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
        required = ["markdown", "opponents", "race", "generated_at"]
        missing = [k for k in required if k not in artifact]
        if missing:
            return [f"artifact missing required keys: {', '.join(missing)}"]
        return []
    except jsonschema.ValidationError as exc:
        return [f"artifact schema violation: {exc.message}"]
    except jsonschema.SchemaError as exc:
        sys.stderr.write(f"warning: contract_schema.json is not a valid JSON Schema: {exc}\n")
        required = ["markdown", "opponents", "race", "generated_at"]
        missing = [k for k in required if k not in artifact]
        if missing:
            return [f"artifact missing required keys: {', '.join(missing)}"]
        return []


def main():
    workspace = _workspace()
    scratch_dir = os.path.join(workspace, "scratch")
    output_dir = os.path.join(workspace, "output")
    os.makedirs(output_dir, exist_ok=True)

    params = _load_params()
    fragments = _load_fragments(scratch_dir)
    closing_note = _load_closing_note(scratch_dir)

    artifact = _build_artifact(params, fragments, closing_note)

    output_path = os.path.join(output_dir, "opposition_research.json")
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, indent=2, ensure_ascii=False)

    reasons = _spot_checks(artifact, params)
    reasons += _validate_shape(workspace, artifact)

    if reasons:
        print("FAIL: " + "; ".join(reasons))
        sys.exit(1)
    print("PASS")
    sys.exit(0)


if __name__ == "__main__":
    main()
