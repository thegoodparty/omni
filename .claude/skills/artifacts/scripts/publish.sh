#!/usr/bin/env bash
# Publish a folder of static files to https://<slug>.artifacts.goodparty.org
# Usage: publish.sh [--update] <folder> <slug>
#   --update  publish a new version of an artifact you already own
set -euo pipefail

update=false
if [ "${1:-}" = "--update" ]; then update=true; shift; fi
folder="${1:-}"; slug="${2:-}"
if [ -z "$folder" ] || [ -z "$slug" ]; then
  echo "usage: publish.sh [--update] <folder> <slug>" >&2; exit 2
fi
[ -f "$folder/index.html" ] || { echo "no index.html in $folder" >&2; exit 1; }
if ! printf '%s' "$slug" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'; then
  echo "slug must be lowercase letters, digits and hyphens, 63 characters at most" >&2; exit 1
fi

# Without these, `vercel deploy` creates a new project named after the folder.
export VERCEL_ORG_ID=team_e4HAh1NYJW4yYc38qx66yTtG
export VERCEL_PROJECT_ID=prj_mZyNcY3dqoIihryPvjp9rCdrf2TY
host="$slug.artifacts.goodparty.org"
# Delegate has VERCEL_TOKEN; a person's agent uses their `vercel login`.
tok=()
if [ -n "${VERCEL_TOKEN:-}" ]; then tok=(--token "$VERCEL_TOKEN"); fi
vc() { npx -y vercel@latest "$@" ${tok[@]+"${tok[@]}"} --scope good-party; }

# Every unclaimed slug resolves to the production placeholder. Anything else,
# including a failed check, may be someone's artifact, so refuse it.
target=$(vc inspect "https://$host" --json 2>/dev/null \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('target') or 'unknown')" 2>/dev/null) || target=unknown
if [ "$update" = false ] && [ "$target" != production ]; then
  echo "$host already exists or could not be checked. Pick another slug, or pass --update if it is yours." >&2; exit 1
fi

# Deploy a branded copy so the source folder is never modified: GoodParty
# favicon, plus a thin bar with the logo and an internal-only label.
assets="$(cd "$(dirname "$0")/../assets" && pwd)"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R "$folder"/. "$stage"
mkdir -p "$stage/_gp"
cp "$assets"/* "$stage/_gp/"
[ -e "$stage/favicon.ico" ] || cp "$assets/favicon.ico" "$stage/favicon.ico"
python3 - "$stage" <<'PY'
import pathlib, re, sys

icons = (
    '<link rel="icon" href="/_gp/favicon-32x32.png" sizes="32x32" type="image/png">'
    '<link rel="apple-touch-icon" href="/_gp/apple-touch-icon.png">'
)
bar = (
    '<div id="gp-artifact-bar" style="all:initial;box-sizing:border-box;display:flex;'
    'align-items:center;justify-content:space-between;width:100%;height:32px;'
    'padding:0 16px;background:#fff;border-bottom:1px solid #e5e7eb;'
    'font:500 11px/1 system-ui,-apple-system,sans-serif;color:#6b7280">'
    '<img src="/_gp/logo.svg" alt="GoodParty.org" style="all:initial;display:block;height:16px">'
    '<span style="all:initial;font:inherit;color:inherit">Internal use only</span></div>'
)
for page in pathlib.Path(sys.argv[1]).rglob('*.html'):
    html = page.read_text(encoding='utf-8', errors='surrogateescape')
    if 'gp-artifact-bar' in html:
        continue
    if not re.search(r'<link[^>]+rel=["\']?(shortcut )?icon', html, re.I):
        html, n = re.subn(r'</head>', icons + '</head>', html, count=1, flags=re.I)
        if not n:
            html = icons + html
    html, n = re.subn(r'(<body[^>]*>)', lambda m: m.group(1) + bar, html, count=1, flags=re.I)
    if not n:
        html = bar + html
    page.write_text(html, encoding='utf-8', errors='surrogateescape')
PY

cd "$stage"
url=$(vc deploy --yes --json --meta "artifact=$slug" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print((d.get('deployment') or d)['url'])")
vc alias set "$url" "$host" >/dev/null || { echo "deployed $url but could not alias $host; report this, do not share the raw URL" >&2; exit 1; }
vc curl / --deployment "https://$host" >/dev/null 2>&1 || { echo "published, but https://$host did not load" >&2; exit 1; }
echo "https://$host"
