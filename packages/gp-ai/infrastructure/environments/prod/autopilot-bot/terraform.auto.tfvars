# Non-secret ClickUp/Slack identifiers for the prod Autopilot conductor,
# committed so CI can plan and apply with no hand-created files (same
# *.auto.tfvars convention as the dev root). Wired ahead of the prod webhook
# by ENG-11153 — see this directory's README.md for the rollout runbook.

# ClickUp user id the AUTOPILOT_CLICKUP_API_KEY in AI_SECRETS_PROD will
# belong to (same bot account as dev). The human-actor gate ignores this
# user's own writes, so any OTHER human must be the one to move a card
# through a gate.
autopilot_bot_user_id = "150125283"

# #autopilot Slack channel (not a secret — a channel id, not a credential).
# Dispatch fails closed without it, so it is set before the webhook exists.
autopilot_slack_channel = "C0C1K9FBDG9"

# autopilot_list_ids stays at its "" default ON PURPOSE: every webhook event
# 200-skips as "list not in scope" until the prod board decision is made and
# the webhook is registered (README steps 1-2). Setting it is the last
# activation lever, not the first.
