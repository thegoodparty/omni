#!/usr/bin/env bash
#
# Non-secret constants for scripts/setup.sh's GitHub device-flow secrets
# source. A GitHub OAuth App's client_id is public by design — it identifies
# the app, not a caller — so committing it is correct. The device flow (as
# opposed to the web application flow) never uses a client secret at all, so
# there is nothing else to protect here.
#
# OPS PREREQUISITE (pending, see epic ENG-11186's ops prerequisites): the
# "omni local setup" GitHub OAuth App has not been registered yet. Until it
# is and this constant is filled in, scripts/setup.sh's device-flow path
# fails closed with an actionable message before making any network call —
# use --from <path-to-a-working-checkout> in the meantime.
# Consumed by scripts/setup.sh, which sources this file; shellcheck can't
# see that when checking this file on its own.
# shellcheck disable=SC2034
GITHUB_OAUTH_CLIENT_ID=""
