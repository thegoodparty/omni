#!/usr/bin/env bash
# Publish a folder of static files to https://<slug>.artifacts.goodparty.org
# Usage: publish.sh <folder> <slug>
set -euo pipefail

folder="${1:-}"; slug="${2:-}"
if [ -z "$folder" ] || [ -z "$slug" ]; then
  echo "usage: publish.sh <folder> <slug>" >&2; exit 2
fi
[ -f "$folder/index.html" ] || { echo "no index.html in $folder" >&2; exit 1; }
[ -n "${VERCEL_TOKEN:-}" ] || { echo "VERCEL_TOKEN is not set" >&2; exit 1; }
if ! printf '%s' "$slug" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'; then
  echo "slug must be lowercase letters, digits and hyphens, 63 characters at most" >&2; exit 1
fi

export VERCEL_ORG_ID=team_e4HAh1NYJW4yYc38qx66yTtG
export VERCEL_PROJECT_ID=prj_mZyNcY3dqoIihryPvjp9rCdrf2TY
host="$slug.artifacts.goodparty.org"
vc() { npx -y vercel@latest "$@" --token "$VERCEL_TOKEN" --scope good-party; }

cd "$folder"
url=$(vc deploy --yes --json --meta "artifact=$slug" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print((d.get('deployment') or d)['url'])")
vc alias set "$url" "$host" >/dev/null || { echo "deployed $url but could not alias $host; report this, do not share the raw URL" >&2; exit 1; }
vc curl / --deployment "https://$host" >/dev/null
echo "https://$host"
