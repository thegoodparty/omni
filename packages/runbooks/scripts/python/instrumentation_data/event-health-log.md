# Analytics event-health log (DATA-1952)

Longitudinal history. `analytics_event_health.py` appends one dated section per run (newest
at the bottom), so a flag can be tracked across passes: active -> anomaly-flagged -> dormant,
with the first appearance of a divergence visible. See `books/monitor-event-health.md` for how
to read and act on each section.

## Status legend

| Status | Code (provenance CSV) | Firing | Meaning |
| --- | --- | --- | --- |
| active | `retired_date` empty | fired in 30d | healthy |
| dormant | empty | quiet 30d | code still present but stopped firing; still intended? |
| deprecating | set | quiet, within 30d window | being retired; in the holding window |
| orphaned_firing | set | still firing | code removed but events still arrive; escalate |
| retired | set | quiet 30d+ | cleanly retired |
| code_unknown | no provenance row | any | auto-tracked or brand-new; anomaly-watched only |
| instrumented_never_observed | present, not retired | never seen | possible broken instrumentation |
| system | n/a | n/a | auto-tracked (`page`, `[Amplitude] …`); never a status flag |

Severity ranks (1 = loudest): 1 orphaned-firing / declared-not-in-use-still-firing · 2 anomaly
drop, active elevated · 3 anomaly drop, active/system · 4 intent divergence · 5 dormant
elevated · 6 instrumented-never-observed · 7 dormant (collapsed to a tail line).

## 2026-06-26

Basis: complete weeks before 2026-06-22. 455 events — active 338, dormant 42, system 39, code_unknown 14, retired 12, deprecating 6, orphaned_firing 4. 50 flagged (16 priority, 34 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Serve Onboarding - Magic Link Activated | orphaned_firing | yes | 30d=17; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 |  |
| 1 orphaned-firing / not-in-use still firing | 10 DLC Compliance - Registration Submitted | orphaned_firing | yes | 30d=9; last_seen 2026-06-05; PR https://github.com/thegoodparty/omni/pull/1049 |  |
| 1 orphaned-firing / not-in-use still firing | Serve Onboarding - Magic Link Sent | orphaned_firing | yes | 30d=3; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 |  |
| 1 orphaned-firing / not-in-use still firing | Profile - Candidate Profile: Submit Success | orphaned_firing |  | 30d=3; last_seen 2026-06-05; PR https://github.com/thegoodparty/omni/pull/1769 |  |
| 2 anomaly drop, active (elevated) | Schedule Text Campaign - Audience: Enter Audience Request | active | yes | 30d=1474; week 14 vs base 410.5; last_seen 2026-06-24 |  |
| 2 anomaly drop, active (elevated) | Onboarding - Office Step: Click Next | active | yes | 30d=244; week 4 vs base 84.2; last_seen 2026-06-25 |  |
| 3 anomaly drop, active | Candidate Website - Edited | active |  | 30d=129; week 2 vs base 40.5; last_seen 2026-06-25; PR https://github.com/thegoodparty/omni/pull/788 |  |
| 3 anomaly drop, active | Candidate Website - Continued | active |  | 30d=79; week 1 vs base 35.8; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/788 |  |
| 5 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 5 dormant (elevated) | Schedule Text Campaign: Submit | dormant | yes | 30d=0; last_seen 2025-06-24 |  |
| 5 dormant (elevated) | Onboarding - Party Step: Click Submit | dormant | yes | 30d=0; last_seen 2026-05-07 |  |
| 5 dormant (elevated) | Onboarding - Complete Step: Click Go to Dashboard | dormant | yes | 30d=0; last_seen 2026-05-07 |  |
| 5 dormant (elevated) | Onboarding - Pledge Step: Click Ask a Question | dormant | yes | 30d=0; last_seen 2025-08-18 |  |
| 5 dormant (elevated) | Onboarding - Registration Completed | dormant | yes | 30d=0; last_seen 2026-04-20; PR https://github.com/thegoodparty/omni/pull/708 |  |
| 5 dormant (elevated) | Onboarding: Click Finish Later | dormant | yes | 30d=0; last_seen 2026-05-06 |  |
| 5 dormant (elevated) | Sign Up: Click Login | dormant | yes | 30d=0; last_seen 2026-04-20 |  |

**Dormant tail (34)** — code present, 0 fires/30d, not elevated: Account - Password Reset Requested · Sign In: Click Create Account · Account - Pro Subscription Confirmed · Settings - Delete Account: Cancel Delete · Contacts - Column Edited · Account - Password Reset Completed · Settings - Delete Account: Submit Delete · Contacts - Segment Deleted · Profile - Running Against: Click Delete · Profile - Running Against: Cancel Edit · Profile - Top Issues: Cancel Delete · Settings - Password: Click Save · Settings - Delete Account: Click Delete · Navigation - Dashboard: Click Community · Download Voter File Failure · schedule_campaign_image_too_large · Profile - Top Issues: Click Delete · Navigation - Dashboard: Click Issues · Account - Password Set Completed · Set Password: Click Set Password · Profile - Top Issues: Submit Delete · Pro Upgrade - Service Agreement Page: Click back · AI Assistant - Chat: Click thumbs down · Content Builder - Editor: Open Kebab Menu · Pro Upgrade - Committee Check Page: Toggle EIN requirement · Sign In: Click Forgot Password · Settings - Personal Info: Click Upload · Content Builder - Editor: Submit Translate · Click to Call CTA Viewed · Polls - Expand Poll Recommendations Completed · Polls - Expand Poll Review Viewed · Payment - Review and Pay Screen Viewed · Click to Call Phone Submitted · Click to Call CTA Clicked

### Changes since last run

- new: 50 (see flagged table)
- resolved: none
- still open: 0 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 248/416 (60%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): Campaign Plan - Weekly Tasks Digest · Campaign Plan V2 - Community Events Generation Completed · Campaign Plan V2 - Community Events Generation Started · Campaign Plan V2 - Media Generation Completed · Campaign Plan V2 - Media Generation Started · Campaign Plan V2 - Opportunities & Challenges Generation Completed · Campaign Plan V2 - Opportunities & Challenges Generation Started · Campaign Plan V2 - Opposition Research Generation Completed · Campaign Plan V2 - Opposition Research Generation Started · Campaign Plan V2 - Strategy Race Changed · Dashboard - Campaign Plan Generation Completed · Dashboard - Campaign Plan Viewed · Onboarding - Ballot Status Completed · Onboarding - Know Your Voters Completed · Onboarding - Magic Link Clicked · Onboarding - Magic Link Sent · Onboarding - Office Selection Completed · Onboarding - Party Selection Completed · Onboarding - Path To Victory Completed · Onboarding - Path To Victory Errored · Onboarding - Path To Victory Updated · Onboarding - Pledge Completed · Onboarding - Welcome Completed · Onboarding V2 - Ballot Status Completed · Onboarding V2 - Ballot Status Viewed · Onboarding V2 - Campaign Manager Clicked · Onboarding V2 - Community Events Displayed · Onboarding V2 - Community Events Requested · Onboarding V2 - Community Events Results Received · Onboarding V2 - Media Displayed · Onboarding V2 - Media Requested · Onboarding V2 - Media Results Received · Onboarding V2 - New Campaign Context Completed · Onboarding V2 - New Campaign Context Viewed · Onboarding V2 - Office Completed · Onboarding V2 - Office Next Clicked · Onboarding V2 - Office Viewed · Onboarding V2 - Party Designation Blocked · Onboarding V2 - Party Designation Completed · Onboarding V2 - Party Designation Viewed · Onboarding V2 - Plan Downloaded · Onboarding V2 - Plan Shared · Onboarding V2 - Pledge Completed · Onboarding V2 - Pledge Submit Clicked · Onboarding V2 - Pledge Viewed · Onboarding V2 - Resources Completed · Onboarding V2 - Resources Viewed · Onboarding V2 - Strategic Landscape Displayed · Onboarding V2 - Strategic Landscape Requested · Onboarding V2 - Strategic Landscape Results Received · Onboarding V2 - Voter Insights Completed · Onboarding V2 - Voter Insights Viewed · Onboarding V2 - Votes Needed Calculated · Onboarding V2 - Votes Needed Completed · Onboarding V2 - Votes Needed Failed · Onboarding V2 - Votes Needed Viewed · Onboarding V2 - Welcome Viewed · Serve Onboarding - BR Suggestion Changed · Serve Onboarding - Know Your Constituents Completed · Serve Onboarding - Know Your Constituents Viewed · Serve Onboarding - Magic Link Activated · Serve Onboarding - Magic Link Sent · Serve Onboarding - Net New Completed · Serve Onboarding - Office Completed · Serve Onboarding - Office Status Viewed · Serve Onboarding - Office Viewed · Serve Onboarding - Party Designation Viewed · Serve Onboarding - Pledge Completed · Serve Onboarding - Pledge Viewed · Serve Onboarding - Term Dates Viewed · Serve Onboarding - Welcome Viewed · Sign Up Clicked · Win Onboarding - Magic Link Sent
- Other non-system events missing a description: 95 (not listed).

### Watchlist proposals (self-healing)

58 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Serve Onboarding - Pledge Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Pledge Completed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Know Your Constituents Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Know Your Constituents Completed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Welcome Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Term Dates Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Party Designation Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Office Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Office Status Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Office Completed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Onboarding - Magic Link Sent", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Onboarding - Magic Link Clicked", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Net New Completed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Magic Link Sent", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - BR Suggestion Changed", product: serve, family: serve, floor: null, owner: TBD}
```
(43 more — see the JSON report.)
