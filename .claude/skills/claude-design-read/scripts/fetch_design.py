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
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

EP = "https://api.anthropic.com/v1/design/mcp"
CAP = 256 * 1024  # per-read byte cap; a single line at/over this is cut mid-line
CAP_MARGIN = 4096  # wrapper + notice bytes that sit inside the cap but get stripped
OPEN_TAG = re.compile(r'^<untrusted-project-content\b[^>]*>')
CLOSE_TAG = '\n</untrusted-project-content>'
# Non-final chunks end with a continuation notice on its own line.
NOTE_RE = re.compile(r'\n[^\n]*continue with offset=\d+\][ \t]*$')


def token():
    if sys.platform != "darwin":
        sys.exit(
            "This script reads the design credential from the macOS Keychain via the\n"
            "`security` CLI. Run it on macOS, where /design-login stores the credential.")
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
        "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
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


def _raw_body(txt):
    """Strip the wrapper and the continuation notice, leaving the body still
    entity-encoded. The cap applies to these bytes, so the per-read-cap check
    measures this rather than the unescaped form.

    Two things this deliberately does not do. It does not rstrip newlines: the
    body already carries exactly its own, and trimming then re-adding one
    collapses a chunk that legitimately ends in blank lines, which would make a
    valid file permanently unverifiable. And it cuts at the LAST close tag rather
    than the first, so a content line that happens to begin with the close tag
    cannot truncate the body — the content is untrusted by construction."""
    body = OPEN_TAG.sub('', txt, count=1)
    if body.startswith('\n'):
        body = body[1:]
    cut = body.rfind(CLOSE_TAG)          # last, not first
    if cut != -1:
        body = body[:cut]
    return NOTE_RE.sub('', body)


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
        m = re.search(r'etag="([^"]+)"', head)
        page_etag = m.group(1) if m else None
        if etag is None:
            etag = page_etag
        elif page_etag != etag:
            # The file was saved while we were paging, so pages come from
            # different revisions and the assembly would be a chimera. The
            # line-count check cannot see this: it compares against page one's
            # stale total.
            raise RuntimeError(
                f"{path}: changed while being read (etag {etag} then {page_etag}). "
                f"Pages would come from different revisions. Re-run.")
        if total is None:
            m = re.search(r'total_lines="(\d+)"', head)
            total = int(m.group(1)) if m else None
        rng = re.search(r'lines="(\d+)-(\d+)"', head)
        raw = _raw_body(txt)
        # A single line >= the per-read cap is silently cut mid-line, and a
        # line-count check cannot see it. Fail loudly instead. Measured on the
        # ENCODED bytes: the cap applies before unescaping, and entity expansion
        # (&amp; -> &) shrinks a line enough to slip under the cap after it.
        # len() on a str counts CHARACTERS; the cap is BYTES, and design copy is
        # full of multi-byte punctuation, so encode before measuring. The margin
        # covers the wrapper tag and continuation notice, which sit inside the
        # server's budget but are stripped above — a cut line therefore arrives
        # measurably under the cap.
        longest = max((len(l.encode('utf-8')) for l in raw.split('\n')), default=0)
        if longest >= CAP - CAP_MARGIN:
            raise RuntimeError(
                f"{path}: contains a line of {longest:,} encoded bytes, within "
                f"{CAP_MARGIN:,} bytes of the {CAP:,}-byte per-read cap. It is cut "
                f"mid-line, or cannot be proven not to be, and paging cannot help. "
                f"Refusing to return it.")
        parts.append(html.unescape(raw))
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
        if last < offset:
            raise RuntimeError(
                f"{path}: page starting at line {offset} came back as lines "
                f"{rng.group(1)}-{last}, which does not advance. Refusing to loop.")
        offset = last + 1
    return "".join(parts), total, etag


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    pid, path = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join("scratch", "design_out.txt")
    content, total, etag = read_full(token(), pid, path)
    got = content.count("\n")
    # Verify before writing. Writing first would leave unverified content at the
    # exact path the failure message names, and would clobber a good earlier fetch.
    if total is None:
        sys.exit("FAIL: the server response carried no total_lines, so completeness "
                 "cannot be verified. Nothing written.")
    if got != total:
        sys.exit(f"FAIL: got {got:,} lines, server reported {total:,}. Nothing written.")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w") as fh:
        fh.write(content)
    print(f"{out}: {len(content):,} bytes, {got:,} lines  [OK]  etag={etag or 'unknown'}")
