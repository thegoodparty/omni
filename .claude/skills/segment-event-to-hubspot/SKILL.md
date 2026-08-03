---
name: segment-event-to-hubspot
description: Route a backend Segment event into HubSpot so its fields can trigger workflows and personalize emails — replacing the 2-3 hour manual mapping process. Use when someone asks to "get event X into HubSpot", map event properties to contact properties, or set up a HubSpot workflow off a product event. Given a gp-api Segment event, proposes the HubSpot event definition + property mappings, surfaces similar existing properties, and creates everything via API behind a human approval gate. (DATA-2149)
---

# Segment event → HubSpot mapping

Automates the pipeline that turns a backend Segment event into usable HubSpot
data: event definition, Segment destination subscription, contact properties,
and the workflow that copies event properties onto the contact. Property and
workflow creation stay behind a **hard human approval gate** — the human
judges duplicates and overlap with existing automation; everything mechanical
is automated.

## Prerequisites

**scripts/.env** (in `packages/runbooks/scripts/.env`):
- `SEGMENT_PUBLIC_API_TOKEN` — workspace member + Source Admin on the gp-api
  source
- `HUBSPOT_SANDBOX_TOKEN` — private app token, sandbox portal 51780263
- (later) a prod-portal token via `--token-env`, only after Joe signs off

**Scripts** (in `packages/runbooks/scripts/python/`, run with `uv run`):
- `segment_destination_mapping.py` — destinations, subscriptions
  (create/update, created disabled)
- `hubspot_event_mapping.py` — event definitions, property similarity +
  creation, test sends, v4 flows

## Hard rules

- **Never create a contact property or enable anything without explicit
  per-item human approval.** Present the full proposal table first.
- **The Segment workspace is production.** There is no Segment sandbox.
  Subscriptions are always created `enabled: false` (the script enforces
  this); a human enables after review.
- **HubSpot writes go to the sandbox portal first** (51780263 — it carries
  the full prod property landscape, so similarity matching is meaningful
  there). Prod writes only after Joe's review, via `--token-env`.
- Payload fields that are PII (e.g. `pin_delivery_destination`) default to
  NOT mapped unless the human explicitly approves them.
- Never delete or rename existing HubSpot properties, event definitions, or
  Segment subscriptions. This skill only adds.

## Phase 0 — event discovery (when the user doesn't name an exact event)

Users usually arrive with a product description ("the briefing skip thing",
"when someone upgrades to pro"), not a registry string. Resolve it:

1. Read the `EVENTS` registry in
   `packages/gp-api/src/vendors/segment/segment.types.ts` (grouped by
   domain) and match candidates against the user's description. Remember
   the two Briefing Assistant string-literal events that bypass it.
2. If several candidates fit, show a short table: event name, what fires it
   (one line from its call site), and whether it is already mapped (compare
   against `segment_destination_mapping.py list-subscriptions` for the
   `HubSpot Backend` destination). Let the user pick.
3. If nothing fits, the event may not exist yet — that's an
   instrument-analytics-event job in gp-api first, not a mapping job.

## Phase 1 — resolve the event's schema from code

gp-api code is the source of truth (not the Segment debugger, not the
warehouse):

1. Find the event in the `EVENTS` registry:
   `packages/gp-api/src/vendors/segment/segment.types.ts`. Two Briefing
   Assistant events are raw string literals that bypass the registry — search
   call sites by string too.
2. Read every `analytics.track` call site to enumerate payload fields, types,
   nullability, and PII flags. `email` (and sometimes `impersonation`) is
   auto-merged into every event; `email`+`hubspotId` also ride
   `context.traits`.
3. Cross-check reach in the warehouse (volumes and recency, not schema):
   `goodparty_data_catalog.dbt.stg_segment_storage_source__gp_api_tracks`
   via the Databricks CLI (see `docs/databricks.md`). Flag events that have
   never fired.

Output: a field table — name, type, nullable, example, PII flag.

## Phase 2 — diff against what exists

1. Segment side: `segment_destination_mapping.py list-subscriptions
   <destinationId>` on the `HubSpot Backend` destination (gp-api source;
   find ids with `list-destinations`). Check whether the event already has a
   subscription and which fields the catch-all Firehose already forwards.
2. HubSpot side: `hubspot_event_mapping.py list-event-definitions --search
   <event-name>` (does a definition exist? — search server-side, the list is
   capped at 100) and `similar-properties <field> ...` (rapidfuzz match
   over all contact properties — surface reuse candidates per field).

Output: a mapping proposal table, one row per field: create event property /
forward at destination / reuse existing contact property X / create contact
property (name, type) / skip.

## Phase 3 — human approval gate (hard gate)

Present the proposal as one reviewable table, including naming (follow the
existing `pe<portalId>_<snake_case_event>` convention for event definitions
and lowercase snake_case for properties). Nothing below runs until the human
approves, per field.

## Phase 4 — apply

In this order (all payloads as JSON files fed to the scripts):

1. `hubspot_event_mapping.py create-event-definition` — definition with its
   event properties (`primaryObject: "CONTACT"`).
2. `hubspot_event_mapping.py create-contact-property` — approved new contact
   properties, in the property group the human names.
3. `segment_destination_mapping.py create-subscription` — per-event
   subscription on the `HubSpot Backend` destination: trigger FQL
   `type = "track" and event = "<Event Name>" and properties.email != null`,
   `actionSlug: customEvent`, `settings.event_name` = the definition's
   fullyQualifiedName, `settings.properties` = per-field `@path` mappings.
   Created disabled; human enables in the Segment UI after review.
4. `hubspot_event_mapping.py create-flow` — Automation v4 workflow, created
   disabled: EVENT_BASED enrollment on the definition's `objectTypeId`
   (shape below), actions copying event properties to contact properties.

Event-based enrollment shape (verified working, HTTP 201):

```json
"enrollmentCriteria": {
  "shouldReEnroll": false,
  "type": "EVENT_BASED",
  "eventFilterBranches": [{
    "filterBranches": [],
    "filters": [],
    "eventTypeId": "<objectTypeId of the event definition, e.g. 6-66540117>",
    "operator": "HAS_COMPLETED",
    "filterBranchType": "UNIFIED_EVENTS",
    "filterBranchOperator": "AND"
  }],
  "listMembershipFilterBranches": []
}
```

Copy-event-property action shape (verified end to end 2026-07-27: an
API-created flow with this action stamped a test event's property onto the
contact). One action per field; chain them via `connection.nextActionId`:

```json
{
  "actionId": "1",
  "type": "SINGLE_CONNECTION",
  "actionTypeVersion": 0,
  "actionTypeId": "0-5",
  "fields": {
    "property_name": "<target contact property>",
    "value": {
      "type": "STATIC_VALUE",
      "staticValue": "{{ enrollment_events.enrollment_event_6_66540117.<event property name> }}"
    }
  }
}
```

The token namespace is `enrollment_events.enrollment_event_<objectTypeId
with the dash as an underscore>` — e.g. definition objectTypeId `6-66540117`
becomes `enrollment_event_6_66540117`. The field encoding is strict: it must
be `property_name` plus a `value` object; other spellings return an opaque
HTTP 500.

Full `create-flow` payload envelope the two shapes above slot into (verified
HTTP 201, 2026-07-27). The top-level fields are required — a contact workflow
is `flowType: "WORKFLOW"` + `type: "CONTACT_FLOW"` + `objectTypeId: "0-1"`;
`startActionId` names the first action. Chain actions with
`connection: { "edgeType": "STANDARD", "nextActionId": "<id>" }`; the terminal
action omits `connection`. `create-flow` forces `isEnabled: false` regardless:

```json
{
  "isEnabled": false,
  "flowType": "WORKFLOW",
  "type": "CONTACT_FLOW",
  "objectTypeId": "0-1",
  "name": "<Event> -> stamp contact properties",
  "startActionId": "1",
  "enrollmentCriteria": { "...": "the EVENT_BASED shape above" },
  "actions": [
    { "actionId": "1", "...": "copy-event-property action",
      "connection": { "edgeType": "STANDARD", "nextActionId": "2" } },
    { "actionId": "2", "...": "next field, last action omits connection" }
  ]
}
```

After create, `get-flow <id>` and confirm `enrollmentCriteria.type`,
`shouldReEnroll`, the `eventTypeId`, and each action's `property_name` +
`staticValue` survived — HubSpot can silently reshape a malformed flow.

## Phase 5 — verify end to end

1. `hubspot_event_mapping.py send-test` — synthetic occurrence with realistic
   values from Phase 1, against a designated test contact.
2. Enable the workflow (human, UI), send again, then
   `hubspot_event_mapping.py get-contact <email> --properties ...` to confirm
   the workflow stamped every field. Report pass/fail per field.

This replaces the old testing loop (wait for a live fire, catch it within an
hour in the Segment debugger).

## Known quirks

- **First-send race:** an event occurrence sent immediately after enabling a
  flow may not enroll anyone. Wait a minute, send again, then poll the
  contact (the stamp typically lands within ~30s of the second send).
- Fields not mapped in a Segment subscription are **silently dropped** — the
  destination never errors. Phase 2's diff is what protects against this.
- The catch-all `Firehose Event V2` subscription delivers every track to
  `pe21589597_segment___all_track` in parallel with per-event subscriptions,
  so mapped events land twice. Legacy workflows depend on all_track; do not
  disable it.
- Event definition `fullyQualifiedName` is portal-prefixed
  (`pe<portalId>_...`), so sandbox and prod names differ. Workflows reference
  the `objectTypeId` (`6-<id>`), which also differs per portal — never copy
  ids between portals.
- There are two sandboxes: the private-app token targets 51780263 (full prod
  property landscape); the claude.ai HubSpot MCP connects to 49209538
  (bare). Use the token/scripts, not the MCP, for anything real.
- Missing app scopes surface as HTTP 403 with a scopes message; as of
  2026-07-27 the sandbox app still lacks `crm.schemas.contacts.write` and
  `crm.objects.contacts.write`.
- gp-api's `HUBSPOT_INTEGRATION.md` describes only the all_track pattern and
  is stale; the live per-event config in Segment is the reference.
