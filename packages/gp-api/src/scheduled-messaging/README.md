# `src/scheduled-messaging/`

Schedules outgoing messages (currently SMS via Peerly, email via Mailgun) for future delivery.

`scheduled-messaging.service.ts` exposes the public API. Reads pending messages from the DB every hour on the `scheduledMessagesSend` pg-boss schedule (`src/jobs/jobs.registry.ts`) and dispatches them. Failures retry on the next tick — no exponential backoff today. A message an interrupted run left `processing` is failed after 30 minutes, not resent, since it may already have gone out.
