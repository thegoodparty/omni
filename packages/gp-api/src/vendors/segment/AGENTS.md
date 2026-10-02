# vendors/segment/

`segment.types.ts` is the backend `EVENTS` registry. Events fire through `AnalyticsService`
to Segment, which forwards them to Amplitude and HubSpot.

## Gotchas

- **HubSpot workflows trigger on some of these names** (the `DO NOT MODIFY` blocks). Removing
  or renaming one breaks an email sequence or a compliance status silently. See
  `HUBSPOT_INTEGRATION.md`.
- **The Analytics guard check covers this file.** It blocks a PR that removes an event's last
  call site but leaves its key, or removes a call site of an event an OKR counts without an
  `intents:` row. Use the `instrument-analytics-event` skill.
