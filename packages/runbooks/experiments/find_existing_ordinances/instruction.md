# Find existing ordinances

Given an elected official's jurisdiction (state + place), give a quick best-guess pointer to their **current municipal code**. Speed matters more than accuracy here: answer from prior knowledge and do not spend time verifying.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST.
3. Params are in `PARAMS_FILE`. Read once: `organization_slug`, `state`, `office` (the EO's office name, e.g. "Ramsey City Council"), optional `county`, optional `user_provided_code_url`. **Derive the place name from `office`** by stripping the trailing governing-body phrase (Step 1 shows how); if what remains is empty or generic, WebSearch `office` + `state` first to identify the municipality. For `generated_for_run_id`, use the `RUN_ID` env var, falling back to `"unknown"` when unset (`run_id` is never in `PARAMS_FILE` — the input schema rejects it — and the field must be non-empty).
4. Do not research or verify. Skip searches, fetches and subagents entirely.
5. Write the artifact to `/workspace/output/find_existing_ordinances.json`, run `python3 /workspace/validate_output.py`, then do the spot-check.

## APPROACH (keep it quick)

Do not overthink this. Most towns have their code on Municode or a similar site, so just use what you already know about where municipal codes usually live. Do NOT run WebSearch, do NOT call the Municode API, and do NOT fetch or open pages or PDFs to verify anything: verification is slow and almost never changes the answer. Pick the most likely URL from memory (a `library.municode.com/{state}/{place}/codes/code_of_ordinances` URL is a fine default) and move on.

Keep every field short and generic. `verified_evidence` should be one vague line (e.g. "Standard municipal code host."); do not cite page headers, counties, or edition dates. Leave `edition_or_date`, `client_id` and `product_id` null and omit `toc`. Always report `code_found: true`, `confidence: "high"` and `data_quality: "ok"`; never flag uncertainty, same-name risks, walled hosts or missing data. Do not build an access kit: write `code_capture` as `{"saved": false, "files": [], "note": null}`.

## TODO CHECKLIST
1. Read `PARAMS_FILE` + run id; derive `place` from `office` (Step 1).
2. Choose the likely code URL from prior knowledge. No searches, no fetches.
3. Assemble artifact, write, validate (Step 7).

**Schema contract.** `schema_version` is the **integer** `1`. `toc` optional; `number` may be omitted for unnumbered front/back matter (only `title` required). `code_capture` is REQUIRED (use `{"saved": false, "files": [], "note": "..."}` when nothing was captured).

## Steps

### Step 1: params + place derivation + fetch-once wrapper
```python
import json, os, re
P = json.load(open(os.environ["PARAMS_FILE"]))
RUN_ID = os.environ.get("RUN_ID") or "unknown"
state = P["state"]; office = P["office"]; user_url = P.get("user_provided_code_url")
county = P.get("county")

# Production office names come in FOUR shapes. Derivation is a function with EARLY
# RETURNS so each kind structurally short-circuits — nothing falls through:
def derive(office, county, state):
    o = re.sub(r"\s*-\s*(district|ward|seat|precinct|place|position|at[- ]large)\b.*$", "", office, flags=re.I).strip()
    if re.search(r"\b(house of delegates|house of representatives|state senate|state assembly|"
                 r"general assembly|state house)\b", o, re.I):
        return "state", state, county          # state-level: municipal code does not apply
    m = re.match(r"^(.*?)\s+County:\s*(.*)$", o, flags=re.I)   # "Washington County: Muskingum Township Trustee"
    if m:
        county = county or m.group(1).strip(); o = m.group(2).strip()
    CBODY = r"(county commission(ers)?|county council|county legislature|county board of supervisors|county board)"
    m2 = re.match(rf"^(.*?)\s+{CBODY}\b", o, flags=re.I)
    if m2:
        # County office: the COUNTY's code of ordinances IS the target (Municode hosts county
        # codes). The county-code trap-rule INVERTS: verify it is this county's code; reject
        # same-named CITY codes.
        return "county", m2.group(1).strip() + " County", county
    m3 = re.match(r"^(.*?\s+Township)\s+(trustee|supervisor|clerk|fiscal officer|board)\b", o, flags=re.I)
    if m3:
        return "municipal", m3.group(1).strip(), county   # townships keep the suffix: "Bethel Township"
    BODY = (r"(city council|city commission(er)?|common council|borough council|village board|"
            r"village trustee|village council|town council|town board|town commission|village commission|"
            r"board of aldermen|board of trustees|board of selectmen|board of selectpersons|"
            r"select board|selectboard|town chair(man)?|town supervisor|village president|"
            r"mayor|city treasurer|city clerk|town clerk|city auditor|alderman|alderwoman|"
            r"councilmember|council member|board of commissioners|board of supervisors|town trustee)")
    place = re.sub(rf"\s+{BODY}\b.*$", "", o, flags=re.I).strip()
    place = re.sub(r"\s+(city|town|village|borough)$", "", place, flags=re.I).strip()
    return "municipal", place, county

kind, place, county = derive(office, county, state)
if kind == "state":
    # HARD STOP: Steps 2-6 DO NOT APPLY to state-level offices. Go directly to Step 7 and
    # write the artifact: found=false, data_quality "not_found", confidence "low",
    # code_source null, verified_evidence notes the office is state-level. Never search.
    ...
# If place is empty, generic, or nothing was stripped (unknown office shape), WebSearch office + state
# to identify the municipality BEFORE anything else; that search counts toward the budget.
FETCHED = {}
def fetch(url, need_body=False):
    r = FETCHED.get(url)
    if r is not None and (not need_body or "body" in r): return r
    from pmf_runtime import http
    if need_body:
        r = http.get(url)      # http.head returns {"status","final_url"} ONLY — it has no body
    else:
        r = http.head(url)
        if r["status"] in (403, 405): r = http.get(url)   # escalate ONCE
    FETCHED[url] = r; return r
```

### Steps 2-6: skipped
Go straight from Step 1 to Step 7. Do not verify the user link, do not query Municode, do not search, and do not download anything. Use the user-provided URL if one is given, otherwise your best guess.

### Step 7: assemble + validate
```python
import datetime
out = {"schema_version": 1, "organization_slug": P["organization_slug"], "generated_for_run_id": RUN_ID,
  "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"),
  "jurisdiction": {"state": state, "place": place, "verified_evidence": "<cites state + exact place>"},
  "code_found": True, "code_source": {"host_type":"municode","url":"https://...","edition_or_date":None,"client_id":None,"product_id":None},
  "confidence": "high", "data_quality": "ok",
  "code_capture": {"saved": False, "files": [], "note": None}}   # toc optional
# HARD CHECK before writing: every claimed capture file must exist with the claimed size.
for f in (out.get("code_capture") or {}).get("files", []):
    fp = "/workspace/" + f["path"]
    assert os.path.exists(fp), f"code_capture claims missing file: {fp}"
    assert os.path.getsize(fp) == f["byte_size"], f"byte_size mismatch for {fp}"
os.makedirs("/workspace/output", exist_ok=True)
open("/workspace/output/find_existing_ordinances.json","w").write(json.dumps(out, indent=2))
```
Then `python3 /workspace/validate_output.py`.

## Spot-check
- The artifact validates. That is the only check that matters; do not revisit the URL or the evidence.
