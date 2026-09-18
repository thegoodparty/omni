#!/usr/bin/env python3
"""Fetch a Claude Design project file IN FULL.

Needed because `DesignSync.get_file` caps a read at 256 KiB and reports success
while truncating — a real design comes back as roughly its first third with no
error, which is worse than a failure. The cap is per-READ, not per-file: the
underlying MCP tool is `read_file` and it takes offset/limit, so this pages and
reassembles, then checks the assembled line count against the server's own total.

Auth comes from `/design-login`, once per machine. The token is short-lived; if a
run 401s, make any DesignSync MCP call to refresh the stored credential and retry.

Known limit: a file containing a SINGLE LINE of 256 KiB or more is cut mid-line
and paging cannot help. A line-count check does not detect that, so it is checked
separately and raises. This affects minified bundles, not authored source.

Usage: .claude/skills/claude-design-read/scripts/fetch_design.py \
         <project_id> <path> [out_file]

  project_id and path come out of the design URL:
  claude.ai/design/p/<project_id>?file=<path>
"""
import html
import json
import re
import subprocess
import sys
import urllib.request

EP = "https://api.anthropic.com/v1/design/mcp"
CAP = 256 * 1024  # per-read byte cap; a single line at/over this is cut mid-line
OPEN_RE = re.compile(r'^<untrusted-project-content\b[^>]*>\n', re.S)
OPEN_TAG = re.compile(r'^<untrusted-project-content\b[^>]*>')
CLOSE_RE = re.compile(r'\n</untrusted-project-content>.*$', re.S)
# Non-final chunks end with a continuation notice on its own line.
NOTE_RE = re.compile(r'\n[^\n]*continue with offset=\d+\][ \t]*$')


def token():
    try:
        r = subprocess.run(
            ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit(
            "This script reads the design credential from the macOS Keychain via the\n"
            "`security` CLI, which is not present here. Run it on macOS, where\n"
            "/design-login stores the credential.")
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("No Claude Code credentials in the keychain. Run /design-login.")
    try:
        creds = json.loads(r.stdout)
    except json.JSONDecodeError:
        sys.exit("Could not parse the keychain credential. Run /design-login.")
    design = creds.get("designOauth") or {}
    if not design.get("accessToken"):
        sys.exit(
            "No design authorization found (the `designOauth` credential is absent,\n"
            "not merely expired). Run /design-login, then re-run this script.\n"
            "The design token is short-lived, so this also happens if it was cleared.")
    return design["accessToken"]


def call(tok, name, args, rid=1):
    body = json.dumps({"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                       "params": {"name": name, "arguments": args}}).encode()
    req = urllib.request.Request(EP, data=body, headers={
        "Authorization": f"Bearer {tok}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"})
    try:
        with urllib.request.urlopen(req) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit(
                "401 Unauthorized — the design token has expired (it lasts hours,\n"
                "not days). Fix: make any DesignSync call first, e.g.\n"
                "  DesignSync(method='get_project', projectId='<id>')\n"
                "which refreshes the stored credential. Then re-run this script.\n"
                "If that also fails, run /design-login again.")
        raise
    res = d.get("result", {})
    txt = next((c["text"] for c in res.get("content", []) if c.get("type") == "text"), "")
    if res.get("isError"):
        raise RuntimeError(f"{name}: {txt}")
    return txt


def _body_of(txt):
    """Strip the wrapper, the continuation notice, and unescape entities."""
    body = CLOSE_RE.sub('', OPEN_RE.sub('', txt))
    body = NOTE_RE.sub('', body.rstrip('\n')).rstrip('\n')
    return html.unescape(body) + '\n'


def read_full(tok, project_id, path, verbose=True):
    """Page through a file. Returns (content, total_lines, etag)."""
    parts, offset, total, etag = [], 1, None, None
    while True:
        txt = call(tok, "read_file",
                   {"project_id": project_id, "path": path, "offset": offset}, offset)
        # Parse the whole opening tag, not a fixed-size slice: a long file path can
        # push total_lines past any byte window, and losing it means losing the only
        # completeness check there is.
        tag = OPEN_TAG.match(txt)
        head = tag.group(0) if tag else txt[:2000]
        if total is None:
            m = re.search(r'total_lines="(\d+)"', head)
            total = int(m.group(1)) if m else None
            m = re.search(r'etag="([^"]+)"', head)
            etag = m.group(1) if m else None
        rng = re.search(r'lines="(\d+)-(\d+)"', head)
        chunk = _body_of(txt)
        # A single line >= the per-read cap is silently cut mid-line, and a
        # line-count check cannot see it. Fail loudly instead.
        longest = max((len(l) for l in chunk.split('\n')), default=0)
        if longest >= CAP:
            raise RuntimeError(
                f"{path}: contains a line of {longest:,} bytes, at/over the "
                f"{CAP:,}-byte per-read cap. It is cut mid-line and CANNOT be "
                f"retrieved in full by paging. Do not use this content.")
        parts.append(chunk)
        if not rng:
            break
        last = int(rng.group(2))
        if verbose:
            print(f"  lines {rng.group(1)}-{last} of {total}", file=sys.stderr)
        if total is None:
            # Paging without a total means no way to tell a complete file from a
            # truncated one, which is the failure this whole script exists to stop.
            raise RuntimeError(
                f"{path}: the server response carries lines=\"{rng.group(1)}-{last}\" "
                f"but no total_lines, so completeness cannot be verified. Refusing to "
                f"return possibly-partial content.")
        if last >= total:
            break
        offset = last + 1
    return "".join(parts), total, etag


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    pid, path = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else "design_out.txt"
    content, total, etag = read_full(token(), pid, path)
    open(out, "w").write(content)
    got = content.count("\n")
    if total is not None and got != total:
        sys.exit(f"FAIL {out}: got {got:,} lines, server reported {total:,}")
    print(f"{out}: {len(content):,} bytes, {got:,} lines  [OK]  etag={etag}")
