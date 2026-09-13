# Non-secret ClickUp/Slack identifiers for the dev Autopilot board, committed
# so CI can plan and apply with no hand-created files (see main.tf's gitignore
# comment for the *.auto.tfvars convention). Real values wired by ENG-11104 —
# see this directory's README.md for the board/webhook record.

# Autopilot folder 901319488097 (Engineering space 90138877046, team
# 90132012119): "Autopilot features" (901329057923) + "Autopilot stories"
# (901329057924).
autopilot_list_ids = "901329057923,901329057924"

# Subset of autopilot_list_ids that are story lists.
autopilot_story_list_ids = "901329057924"

# ClickUp user id the CLICKUP_API_KEY in AI_SECRETS_DEV belongs to
# ("Collin Park"). The human-actor gate ignores this user's own writes, so
# any OTHER human must be the one to move a card through a gate.
autopilot_bot_user_id = "105985359"

# #autopilot Slack channel (not a secret — a channel id, not a credential).
autopilot_slack_channel = "C0C1K9FBDG9"
