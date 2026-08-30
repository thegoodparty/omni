"""Write the consumer event-state table to a Google Sheet (DATA-2052, sub-ticket C).

Second sink behind event_state_assembler.assemble(); the ClickUp markdown table (sub-ticket
B) could not render 472 rows, so the filterable surface is a Google Sheet embedded in the
ClickUp page. Auth extends the existing OAuth pattern (InstalledAppFlow, cached token) with a
write scope. The live consent + write is a manual step; build_values/write_sheet are unit-tested
against an injected Sheets service.
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
import shutil
import sys
from datetime import date
from pathlib import Path
from typing import Any

import event_state_assembler as esa

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "instrumentation_data"
# The cached OAuth token lives OUTSIDE the checkout (DATA-2061) so one consent survives worktree
# removal and is shared across checkouts — a per-checkout token is lost when its worktree is
# pruned, forcing a fresh browser consent. Resolution: GP_SHEETS_TOKEN_PATH override, then
# $XDG_CONFIG_HOME/gp-event-state, else ~/.config/gp-event-state.
LEGACY_TOKEN_PATH = DATA_DIR / "gsheet_token.pickle"   # pre-DATA-2061 in-checkout location


def _default_token_path() -> Path:
    override = os.environ.get("GP_SHEETS_TOKEN_PATH")
    if override:
        return Path(override).expanduser()
    config_home = os.environ.get("XDG_CONFIG_HOME")
    base = Path(config_home).expanduser() if config_home else Path.home() / ".config"
    return base / "gp-event-state" / "gsheet_token.pickle"


TOKEN_PATH = _default_token_path()
SHEET_TAB = "events"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]   # read/write (not the readonly default)
# Reuse the existing GoogleSheets OAuth client registration by default (same env names the
# gp-ai client uses); override with GP_SHEETS_GOOGLE_* if a dedicated client is set up.
CLIENT_ID_ENVS = ("GP_SHEETS_GOOGLE_CLIENT_ID", "DDHQ_MATCHER_GOOGLE_CLIENT_ID")
CLIENT_SECRET_ENVS = ("GP_SHEETS_GOOGLE_CLIENT_SECRET", "DDHQ_MATCHER_GOOGLE_CLIENT_SECRET")


def build_values(rows: list[dict]) -> list[list[str]]:
    """COLUMNS header row + one row per event; every cell a string, None -> "" (Sheets RAW)."""
    matrix: list[list[str]] = [list(esa.COLUMNS)]
    for row in rows:
        matrix.append(["" if row.get(c) is None else str(row.get(c)) for c in esa.COLUMNS])
    return matrix


GAPS_COLUMNS = [
    "rank", "surface", "surface_type", "disposition", "reason",
    "judge_reason", "rubric_rule", "dashboard_question", "location",
    "first_seen", "last_seen",
]
# The tab column name "surface" is the entry's user-facing id; every other column is a
# direct state key.
_GAP_COL_KEY = {"surface": "id"}


def build_gap_values(state: dict) -> list[list[str]]:
    """GAPS_COLUMNS header + one stringified row per gap, sorted by (rank, id). Mirrors
    build_values: every cell a string, None/missing -> "" for a RAW Sheets write."""
    rows = sorted(state.values(), key=lambda e: (e.get("rank", 5), e.get("id", "")))
    matrix: list[list[str]] = [list(GAPS_COLUMNS)]
    for e in rows:
        line = []
        for col in GAPS_COLUMNS:
            val = e.get(_GAP_COL_KEY.get(col, col))
            line.append("" if val is None else str(val))
        matrix.append(line)
    return matrix


GAPS_TAB = "gaps"


def load_gaps_state(path: Path) -> dict | None:
    """Read the committed disposition state for the gaps tab. Missing -> {} (nothing to
    show yet). Unreadable or non-dict -> None so the caller skips the gaps write with a
    warning rather than crashing the sheet refresh — a bad hand-edit must never take the
    whole refresh down."""
    path = Path(path)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def write_gaps_sheet(state: dict, *, service: Any, spreadsheet_id: str, tab: str = GAPS_TAB) -> int:
    """Full-overwrite `tab` with the gap rows; returns the data-row count (excl. header).
    Same write-then-clear order as write_sheet: a failed update never leaves an empty tab."""
    values = build_gap_values(state)
    sheets = service.spreadsheets()
    sheets.values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A1",
        valueInputOption="RAW",
        body={"values": values},
    ).execute()
    sheets.values().clear(spreadsheetId=spreadsheet_id, range=f"{tab}!A{len(values) + 1}:ZZ").execute()
    return len(values) - 1


META_TAB = "meta"


def event_state_clickup_url() -> str | None:
    """Link back to the ClickUp page that embeds this sheet. None when unset — the meta tab
    then omits the row, same optional-link pattern as the gap browse/feedback links."""
    return os.environ.get("GP_EVENT_STATE_CLICKUP_URL") or None


def build_meta_values(meta: dict, *, clickup_url: str | None = None) -> list[list[str]]:
    """A small key/value 'meta' tab: when the sheet was last refreshed, how many events it
    covers, the provenance source, and (optionally) a link back to the ClickUp page."""
    rows = [
        ["key", "value"],
        ["last_refreshed", str(meta.get("refreshed_at", ""))],
        ["event_count", str(meta.get("event_count", ""))],
        ["provenance_path", str(meta.get("provenance_path", ""))],
    ]
    if clickup_url:
        rows.append(["clickup_page", clickup_url])
    return rows


def write_meta_sheet(
    meta: dict, *, service: Any, spreadsheet_id: str, clickup_url: str | None = None,
    tab: str = META_TAB,
) -> int:
    """Full-overwrite the `meta` tab; returns the data-row count. Same write-then-clear order
    as write_sheet/write_gaps_sheet so a failed update never leaves an empty tab."""
    values = build_meta_values(meta, clickup_url=clickup_url)
    sheets = service.spreadsheets()
    sheets.values().update(
        spreadsheetId=spreadsheet_id, range=f"{tab}!A1",
        valueInputOption="RAW", body={"values": values},
    ).execute()
    sheets.values().clear(spreadsheetId=spreadsheet_id, range=f"{tab}!A{len(values) + 1}:ZZ").execute()
    return len(values) - 1


QUESTIONS_TAB = "questions"
QUESTIONS_COLUMNS = [
    "question", "state", "asked_by", "behaviors", "answering_events",
    "uninstrumented_surfaces", "caveats", "clickup_task",
]
_QUESTION_COL_KEY = {
    "answering_events": "events",
    "uninstrumented_surfaces": "gaps",
    "clickup_task": "question_ref",
}


def build_question_values(rows: list[dict]) -> list[list[str]]:
    """QUESTIONS_COLUMNS header + one row per question. List cells render as a comma list so
    the tab is readable without a formula. answering_events is regenerated from live coverage
    every run, which is what makes supersession maintain itself instead of rotting."""
    matrix: list[list[str]] = [list(QUESTIONS_COLUMNS)]
    for row in rows:
        line = []
        for col in QUESTIONS_COLUMNS:
            val = row.get(_QUESTION_COL_KEY.get(col, col))
            if isinstance(val, (list, tuple)):
                val = ", ".join(str(v) for v in val)
            line.append("" if val is None else str(val))
        matrix.append(line)
    return matrix


def write_questions_sheet(
    rows: list[dict], *, service: Any, spreadsheet_id: str, tab: str = QUESTIONS_TAB
) -> int:
    """Full-overwrite `tab`; returns the data-row count. Same write-then-clear order as
    write_sheet so a failed update never leaves an empty tab."""
    values = build_question_values(rows)
    sheets = service.spreadsheets()
    sheets.values().update(
        spreadsheetId=spreadsheet_id, range=f"{tab}!A1",
        valueInputOption="RAW", body={"values": values},
    ).execute()
    sheets.values().clear(
        spreadsheetId=spreadsheet_id, range=f"{tab}!A{len(values) + 1}:ZZ"
    ).execute()
    return len(values) - 1


def question_rows_for_refresh() -> list[dict]:
    """Shared by the refresh-questions command and the ClickUp write-back so each derives state
    the same way from one Databricks read of its own. They are separate CLI invocations, so
    their reads are minutes apart and can briefly disagree; handing one command's rows to the
    other is the DATA-2302 cleanup. assemble()'s rows already carry event_type and status, which
    is everything coverage reads; re-running reconcile would be a second round trip within the
    command for the same answer."""
    import analytics_event_health as aeh
    import behavior_questions as bqs
    import behavior_registry as brg

    result = esa.assemble(date.today())
    by_type = {r["event_type"]: r for r in result["rows"]}
    return bqs.question_rows(brg.load_validated_behaviors(aeh.WATCHLIST), by_type)


def write_sheet(rows: list[dict], *, service: Any, spreadsheet_id: str, tab: str = SHEET_TAB) -> int:
    """Full-overwrite `tab` with the assembled rows. Returns the data row count (excl. header).
    `service` is a googleapiclient Sheets resource (injected in tests).

    Writes the new values first, then clears only the rows below them. Clearing first would
    leave the consumer sheet empty if the update then failed; this order leaves the prior
    contents intact on a failed update and never produces an empty window."""
    values = build_values(rows)
    sheets = service.spreadsheets()
    sheets.values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A1",
        valueInputOption="RAW",
        body={"values": values},
    ).execute()
    sheets.values().clear(spreadsheetId=spreadsheet_id, range=f"{tab}!A{len(values) + 1}:ZZ").execute()
    return len(values) - 1


def _resolve(envs: tuple[str, ...]) -> str | None:
    for name in envs:
        value = os.environ.get(name)
        if value:
            return value
    return None


def get_sheets_service(token_path: Path = TOKEN_PATH, client_secrets_file: str | None = None):
    """OAuth InstalledAppFlow with cached token (write scope). Interactive on first run only.
    Client creds come from the downloaded client-secrets JSON (``client_secrets_file``, the
    standard Google pattern) when given, else from env vars. Not unit-tested — exercised by
    the live manual step."""
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    token_path = Path(token_path)
    # One-time migration: adopt an existing in-checkout token when the default path (now outside
    # the checkout) has none yet, so a prior consent is not lost (DATA-2061). Skip when the caller
    # passed an explicit override.
    if token_path == TOKEN_PATH and not token_path.exists() and LEGACY_TOKEN_PATH.exists():
        token_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(LEGACY_TOKEN_PATH, token_path)
    if token_path.exists():
        with open(token_path, "rb") as fh:
            creds = pickle.load(fh)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if client_secrets_file:
                flow = InstalledAppFlow.from_client_secrets_file(client_secrets_file, SCOPES)
            else:
                client_id = _resolve(CLIENT_ID_ENVS)
                client_secret = _resolve(CLIENT_SECRET_ENVS)
                if not client_id or not client_secret:
                    raise RuntimeError(
                        "Missing Google OAuth client creds: pass --client-secrets <json> "
                        "(or GP_SHEETS_GOOGLE_CLIENT_SECRETS), or set GP_SHEETS_GOOGLE_CLIENT_ID/SECRET."
                    )
                client_config = {
                    "installed": {
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": ["http://localhost"],
                    }
                }
                flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
            creds = flow.run_local_server(port=0)
        Path(token_path).parent.mkdir(parents=True, exist_ok=True)
        with open(token_path, "wb") as fh:
            pickle.dump(creds, fh)
    return build("sheets", "v4", credentials=creds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the event-state table to a Google Sheet.")
    parser.add_argument(
        "command",
        choices=["refresh", "refresh-gaps", "refresh-questions", "writeback-questions"],
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print matrix dims; reads Databricks but skips Google auth and the sheet write",
    )
    parser.add_argument(
        "--state",
        default=str(DATA_DIR / "instrumentation_gaps.json"),
        help="disposition state JSON for refresh-gaps (default: instrumentation_data/)",
    )
    parser.add_argument(
        "--spreadsheet-id",
        default=os.environ.get("GP_EVENT_STATE_SHEET_ID"),
        help="target Google Sheet id (or GP_EVENT_STATE_SHEET_ID env)",
    )
    parser.add_argument(
        "--client-secrets",
        default=os.environ.get("GP_SHEETS_GOOGLE_CLIENT_SECRETS"),
        help="path to the OAuth client-secrets JSON (or GP_SHEETS_GOOGLE_CLIENT_SECRETS env)",
    )
    parser.add_argument(
        "--override",
        default=None,
        help="path to a JSON file {event_type: {govern_display_name, govern_description, "
        "govern_tags}} overlaid onto the Databricks catalog (DATA-2053 event-driven refresh); "
        "key on the raw event_type (as fired in code), not the Govern display name",
    )
    args = parser.parse_args(argv)

    if args.command == "writeback-questions":
        import question_writeback as qwb
        import questions_clickup as qc

        # The ids default from code (they are pointers, not secrets), so the token is the
        # only thing that can be missing. An env var of the same name still wins.
        api_key = os.environ.get("CLICKUP_API_KEY")
        list_id = os.environ.get("GP_QUESTIONS_LIST_ID") or qc.LIST_ID
        state_field = os.environ.get("GP_QUESTIONS_STATE_FIELD_ID") or qc.STATE_FIELD_ID
        checked_field = os.environ.get("GP_QUESTIONS_CHECKED_FIELD_ID") or qc.CHECKED_FIELD_ID
        options = {
            key: os.environ.get(env_name) or qc.OPTION_IDS[key]
            for key, env_name in (
                ("answerable", "GP_QUESTIONS_OPT_ANSWERABLE"),
                ("partially_answerable", "GP_QUESTIONS_OPT_PARTIAL"),
                ("not_answerable", "GP_QUESTIONS_OPT_NOT"),
            )
        }
        if not api_key:
            print("ClickUp write-back needs CLICKUP_API_KEY", file=sys.stderr)
            return 2
        rows = question_rows_for_refresh()
        current = qwb.fetch_current_state(api_key, list_id)
        if args.dry_run:
            print(f"{len(qwb.changed_rows(rows, current))} of {len(rows)} questions changed")
            return 0
        n = qwb.write_answer_state(
            api_key, rows, state_field_id=state_field, checked_field_id=checked_field,
            option_ids=options, today=date.today(), current=current,
        )
        print(f"updated answer state on {n} question tasks")
        return 0

    if args.command == "refresh-questions":
        rows = question_rows_for_refresh()
        if args.dry_run:
            values = build_question_values(rows)
            print(f"{len(values)} rows x {len(values[0])} cols (incl. header); "
                  f"{len(rows)} questions")
            return 0
        if not args.spreadsheet_id:
            print("--spreadsheet-id or GP_EVENT_STATE_SHEET_ID required for a live write",
                  file=sys.stderr)
            return 2
        service = get_sheets_service(client_secrets_file=args.client_secrets)
        count = write_questions_sheet(rows, service=service, spreadsheet_id=args.spreadsheet_id)
        print(f"wrote {count} questions to sheet {args.spreadsheet_id} (tab {QUESTIONS_TAB})")
        return 0

    if args.command == "refresh-gaps":
        state = load_gaps_state(Path(args.state))
        if state is None:
            print(f"gaps state at {args.state} is unreadable; skipping the gaps tab refresh.",
                  file=sys.stderr)
            return 0
        if args.dry_run:
            values = build_gap_values(state)
            print(f"{len(values)} rows x {len(values[0])} cols (incl. header); {len(state)} gaps")
            return 0
        if not args.spreadsheet_id:
            print("--spreadsheet-id or GP_EVENT_STATE_SHEET_ID required for a live write", file=sys.stderr)
            return 2
        service = get_sheets_service(client_secrets_file=args.client_secrets)
        count = write_gaps_sheet(state, service=service, spreadsheet_id=args.spreadsheet_id)
        print(f"wrote {count} gaps to sheet {args.spreadsheet_id} (tab {GAPS_TAB})")
        return 0

    # Dry-run previews the real output dimensions, so it still runs the (read-only)
    # Databricks query — it only skips the Google auth and the sheet write.
    overrides = None
    if args.override:
        with open(args.override) as fh:
            overrides = json.load(fh)
    result = esa.assemble(date.today(), overrides=overrides)
    rows = result["rows"]

    if args.dry_run:
        values = build_values(rows)
        print(f"{len(values)} rows x {len(values[0])} cols (incl. header); {len(rows)} events")
        return 0

    if not args.spreadsheet_id:
        print("--spreadsheet-id or GP_EVENT_STATE_SHEET_ID required for a live write", file=sys.stderr)
        return 2
    service = get_sheets_service(client_secrets_file=args.client_secrets)
    count = write_sheet(rows, service=service, spreadsheet_id=args.spreadsheet_id)
    print(f"wrote {count} events to sheet {args.spreadsheet_id}")
    write_meta_sheet(
        result["meta"], service=service, spreadsheet_id=args.spreadsheet_id,
        clickup_url=event_state_clickup_url(),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
