#!/usr/bin/env bash
#
# Non-secret constants for scripts/setup.sh's GitHub device-flow secrets
# source. A GitHub OAuth App's client_id is public by design — it identifies
# the app, not a caller — so committing it is correct. The device flow (as
# opposed to the web application flow) never uses a client secret at all, so
# there is nothing else to protect here.
#
# The app is "GoodParty local setup", owned by the thegoodparty GitHub org,
# with device flow enabled and read:org as the only scope requested at
# runtime.
# Consumed by scripts/setup.sh, which sources this file; shellcheck can't
# see that when checking this file on its own.
# shellcheck disable=SC2034
GITHUB_OAUTH_CLIENT_ID="Ov23linvhru2HVra8YWW"
