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

# Every unclaimed slug resolves to the production placeholder, so only a
# preview deployment behind the slug means someone already published there.
target=$(vc inspect "https://$host" --json 2>/dev/null \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('target') or '')" 2>/dev/null || true)
if [ "$update" = false ] && [ -n "$target" ] && [ "$target" != production ]; then
  echo "$host already exists. Pick another slug, or pass --update if it is yours." >&2; exit 1
fi

cd "$folder"
url=$(vc deploy --yes --json --meta "artifact=$slug" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print((d.get('deployment') or d)['url'])")
vc alias set "$url" "$host" >/dev/null || { echo "deployed $url but could not alias $host; report this, do not share the raw URL" >&2; exit 1; }
vc curl / --deployment "https://$host" >/dev/null 2>&1 || { echo "published, but https://$host did not load" >&2; exit 1; }
echo "https://$host"
