"""Write the consumer event-state table to a Google Sheet (DATA-2052, sub-ticket C).

Second sink behind event_state_assembler.assemble(); the ClickUp markdown table (sub-ticket
B) could not render 472 rows, so the filterable surface is a Google Sheet embedded in the
ClickUp page. Auth extends the existing OAuth pattern (InstalledAppFlow, cached token) with a
write scope. The live consent + write is a manual step; build_values/write_sheet are unit-tested
against an injected Sheets service.
"""

from __future__ import annotations

import argparse
import os
import pickle
import sys
from datetime import date
from pathlib import Path
from typing import Any

import event_state_assembler as esa

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "instrumentation_data"
TOKEN_PATH = DATA_DIR / "gsheet_token.pickle"          # cached OAuth token (gitignored)
SHEET_TAB = "events"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]   # read/write (not the readonly default)
# Reuse the existing GoogleSheets OAuth client registration by default (same env names the
# gp-ai-projects client uses); override with GP_SHEETS_GOOGLE_* if a dedicated client is set up.
CLIENT_ID_ENVS = ("GP_SHEETS_GOOGLE_CLIENT_ID", "DDHQ_MATCHER_GOOGLE_CLIENT_ID")
CLIENT_SECRET_ENVS = ("GP_SHEETS_GOOGLE_CLIENT_SECRET", "DDHQ_MATCHER_GOOGLE_CLIENT_SECRET")


def build_values(rows: list[dict]) -> list[list[str]]:
    """COLUMNS header row + one row per event; every cell a string, None -> "" (Sheets RAW)."""
    matrix: list[list[str]] = [list(esa.COLUMNS)]
    for row in rows:
        matrix.append(["" if row.get(c) is None else str(row.get(c)) for c in esa.COLUMNS])
    return matrix


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
    if Path(token_path).exists():
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
    parser.add_argument("command", choices=["refresh"])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print matrix dims; reads Databricks but skips Google auth and the sheet write",
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
    args = parser.parse_args(argv)

    # Dry-run previews the real output dimensions, so it still runs the (read-only)
    # Databricks query — it only skips the Google auth and the sheet write.
    result = esa.assemble(date.today())
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
