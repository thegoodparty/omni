# Analytics event-health log (DATA-1952)

Longitudinal history. `analytics_event_health.py` writes one dated section per run, newest
at the top (below this header), so a flag can be tracked across passes: active ->
anomaly-flagged -> dormant, with the first appearance of a divergence visible. See
`books/monitor-analytics-event-health.md` for how to read and act on each section.

## Status legend

| Status | Code (provenance CSV) | Firing | Meaning |
| --- | --- | --- | --- |
| active | `retired_date` empty | fired in 30d | healthy |
| dormant | empty | quiet 30d | code still present but stopped firing; still intended? |
| deprecating | set | last fire on/before `retired_date`, within 30d window | being retired; in the holding window (includes fresh retirees whose pre-retirement traffic still sits in the 30d count) |
| orphaned_firing | set | last fire *after* `retired_date` (+ grace) | code removed but events still arrive; escalate |
| retired | set | quiet 30d+ | cleanly retired |
| code_unknown | no provenance row | any | auto-tracked or brand-new; anomaly-watched only |
| instrumented_never_observed | present, not retired | never seen | possible broken instrumentation |
| system | n/a | n/a | auto-tracked (`page`, `[Amplitude] …`); never a status flag |

Severity ranks (1 = loudest): 1 orphaned-firing / declared-not-in-use-still-firing · 2 anomaly
drop, active elevated · 3 anomaly drop, active/system · 4 intent divergence · 5 dormant
elevated · 6 instrumented-never-observed · 7 dormant (collapsed to a tail line).

## 2026-07-30

Basis: complete weeks before 2026-07-27. 538 events — active 336, deprecating 84, system 39, dormant 34, retired 23, instrumented_never_observed 21, code_unknown 1. 70 flagged (44 priority, 26 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Settings - Personal Info: Click Upload | active |  | 30d=30; last_seen 2026-07-29 | declared not-in-use but still firing |
| 2 call site removed, name constant remains | Navigation - Dashboard: Click Voter Data | active |  | 30d=19; week 1 vs base 41.5; last_seen 2026-07-18; call_sites=0 (removed 2026-07-20) |  |
| 4 anomaly drop, active | Voter Data: Click Detail View | active |  | 30d=15; week 1 vs base 35.0; last_seen 2026-07-18 |  |
| 4 anomaly drop, active | Voter Data - File Detail: Click Custom File Info Icon | active |  | 30d=1; week 1 vs base 30.8; last_seen 2026-06-30 |  |
| 5 intent divergence | Profile - Why Running: Click Save | deprecating |  | 30d=9; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Profile - Policy Priorities: Click Save | deprecating |  | 30d=9; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Community Issues - High Priority Trending Issue Created | deprecating |  | 30d=6; last_seen 2026-07-14; PR https://github.com/thegoodparty/omni/pull/437 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Viewed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Completed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Requested | deprecating |  | 30d=0; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Activated | retired | yes | 30d=0; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Displayed | deprecating |  | 30d=0; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Results Received | deprecating |  | 30d=0; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Sent | retired | yes | 30d=0; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Win Onboarding - Magic Link Sent | retired | yes | 30d=0; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/318 | declared in-use but code removed + quiet |
| 6 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 6 dormant (elevated) | Serve Onboarding - Add Image Viewed | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1022 |  |
| 6 dormant (elevated) | Serve Onboarding - Poll Preview Viewed | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1022 |  |
| 6 dormant (elevated) | Serve Onboarding - SMS Poll Creation Failed | dormant | yes | 30d=0; last_seen 2026-06-17; PR https://github.com/thegoodparty/omni/pull/1374 |  |
| 6 dormant (elevated) | Serve Onboarding - Success Page Viewed | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1098 |  |
| 6 dormant (elevated) | Serve Onboarding - Poll Image Uploaded | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1022 |  |
| 6 dormant (elevated) | Serve Onboarding - SMS Poll Sent | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1022 |  |
| 6 dormant (elevated) | Serve Onboarding - Party Designation Blocked | dormant | yes | 30d=0; last_seen 2026-06-25; PR https://github.com/thegoodparty/omni/pull/254 |  |
| 7 instrumented, never observed | Community Issues - Dispatch Skipped | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/701 |  |
| 7 instrumented, never observed | Constituent Data - Activity List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Dictation - Failed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1056 |  |
| 7 instrumented, never observed | Dictation - Started | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1056 |  |
| 7 instrumented, never observed | Ordinances - Authority Completed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Authority Viewed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Clarify Completed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Clarify Viewed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Current Law Completed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Current Law Viewed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Draft Creation Completed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Draft Creation Viewed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Draft Details Deleted | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Draft Details Downloaded | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Draft Details Status Updated | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - Draft Details Viewed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - How Others Solved It Completed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Ordinances - How Others Solved It Viewed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/1039 |  |
| 7 instrumented, never observed | Voter Data - Activity List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Win - Opponent Activity Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Self Research Completed | instrumented_never_observed |  | 30d=0 |  |

**Dormant tail (26)** — code present, 0 fires/30d, not elevated: Account - Password Reset Requested · Candidate Website - Unpublished · Voter Data - Custom Voter File - Audience: Click Back · Account - Pro Subscription Confirmed · Voter Data - File Detail - Learn & Take Action: Click Schedule · Click to Call CTA Viewed · Voter Data - Need Help: Submit · Voter Data: Click Need Help · Profile - Running Against: Cancel Edit · Voter Data - File Detail - Learn & Take Action: Click Read More · Navigation - Dashboard: Click Community · Voter Data - Need Help: Exit modal · schedule_campaign_image_too_large · Profile - Running Against: Submit Edit · Candidate Website - Started domain selection · Candidate Website - Continued · Candidate Website - Selected domain · Voter Data - Need Help: Select Voter File type · Candidate Website - Purchased domain · Content Builder - Editor: Open Kebab Menu · Profile - Running Against: Click Edit · Profile - Top Issues: Cancel Edit · Pro Upgrade - Committee Check Page: Click Upload · Briefing Assistant - Agenda Submission Failed · Click to Call Phone Submitted · Click to Call CTA Clicked

### Changes since last run

- new: 16 (see flagged table)
- escalated: none
- resolved: AI Assistant - Chat History: Click delete, AI Assistant - Chat History: Click menu, AI Assistant - Chat: Click thumbs down, Briefing Assistant - Dictation Started, Constituent Data - Contact Searched, Constituent Data - Contact Viewed, Constituent Data - Note Added, Voter Outreach - 10DLC Compliance Rejected
- still open: 54 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 454/478 (95%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): Voter Outreach - 10DLC Compliance PIN Sent
- Other non-system events missing a description: 23 (not listed).

### Watchlist proposals (self-healing)

109 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Onboarding V2 - Onboarding Skipped", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Onboarding V2 - Why Are You Running Viewed", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Onboarding V2 - Why Are You Running Completed", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Onboarding V2 - What's Your Background Viewed", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Onboarding V2 - What's Your Background Completed", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Onboarding V2 - What Issues Do You Want To Solve Viewed", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Onboarding V2 - What Issues Do You Want To Solve Completed", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Voter Outreach - 10DLC Compliance Rejected", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Voter Outreach - 10DLC Compliance PIN Resent", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Briefing Assistant - Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Voter Outreach - 10DLC Compliance Candidate Profile Submitted", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
```
(94 more — see the JSON report.)

## 2026-07-27

Basis: complete weeks before 2026-07-27. 515 events — active 336, deprecating 69, system 39, dormant 38, retired 23, instrumented_never_observed 9, code_unknown 1. 62 flagged (32 priority, 30 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Settings - Personal Info: Click Upload | active |  | 30d=25; last_seen 2026-07-25 | declared not-in-use but still firing |
| 2 call site removed, name constant remains | Navigation - Dashboard: Click Voter Data | active |  | 30d=19; week 1 vs base 41.5; last_seen 2026-07-18; call_sites=0 (removed 2026-07-20) |  |
| 4 anomaly drop, active | Voter Data: Click Detail View | active |  | 30d=15; week 1 vs base 35.0; last_seen 2026-07-18 |  |
| 4 anomaly drop, active | Voter Data - File Detail: Click Custom File Info Icon | active |  | 30d=1; week 1 vs base 30.8; last_seen 2026-06-30 |  |
| 5 intent divergence | Profile - Why Running: Click Save | deprecating |  | 30d=14; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Profile - Policy Priorities: Click Save | deprecating |  | 30d=12; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Community Issues - High Priority Trending Issue Created | deprecating |  | 30d=6; last_seen 2026-07-14; PR https://github.com/thegoodparty/omni/pull/437 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Requested | deprecating |  | 30d=1; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Displayed | deprecating |  | 30d=1; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Results Received | deprecating |  | 30d=1; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Activated | retired | yes | 30d=0; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Sent | retired | yes | 30d=0; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Win Onboarding - Magic Link Sent | retired | yes | 30d=0; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/318 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Viewed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Completed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 6 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 6 dormant (elevated) | Serve Onboarding - Add Image Viewed | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1022 |  |
| 6 dormant (elevated) | Serve Onboarding - Poll Preview Viewed | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1022 |  |
| 6 dormant (elevated) | Serve Onboarding - SMS Poll Creation Failed | dormant | yes | 30d=0; last_seen 2026-06-17; PR https://github.com/thegoodparty/omni/pull/1374 |  |
| 6 dormant (elevated) | Serve Onboarding - Success Page Viewed | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1098 |  |
| 6 dormant (elevated) | Serve Onboarding - Poll Image Uploaded | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1022 |  |
| 6 dormant (elevated) | Serve Onboarding - SMS Poll Sent | dormant | yes | 30d=0; last_seen 2026-06-26; PR https://github.com/thegoodparty/omni/pull/1022 |  |
| 6 dormant (elevated) | Serve Onboarding - Party Designation Blocked | dormant | yes | 30d=0; last_seen 2026-06-25; PR https://github.com/thegoodparty/omni/pull/254 |  |
| 7 instrumented, never observed | Community Issues - Dispatch Skipped | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/701 |  |
| 7 instrumented, never observed | Constituent Data - Activity List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Constituent Data - Contact Searched | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Constituent Data - Contact Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Constituent Data - Note Added | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - Activity List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Voter Outreach - 10DLC Compliance Rejected | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/974 |  |
| 7 instrumented, never observed | Win - Opponent Activity Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Self Research Completed | instrumented_never_observed |  | 30d=0 |  |

**Dormant tail (30)** — code present, 0 fires/30d, not elevated: Account - Password Reset Requested · Voter Data - Custom Voter File - Audience: Click Back · Candidate Website - Unpublished · Account - Pro Subscription Confirmed · Voter Data - File Detail - Learn & Take Action: Click Schedule · Click to Call CTA Viewed · Voter Data - Need Help: Submit · Voter Data: Click Need Help · Profile - Running Against: Cancel Edit · Voter Data - File Detail - Learn & Take Action: Click Read More · Navigation - Dashboard: Click Community · Voter Data - Need Help: Exit modal · AI Assistant - Chat History: Click delete · schedule_campaign_image_too_large · Profile - Running Against: Submit Edit · Candidate Website - Continued · Candidate Website - Started domain selection · Candidate Website - Selected domain · Voter Data - Need Help: Select Voter File type · Candidate Website - Purchased domain · AI Assistant - Chat: Click thumbs down · Content Builder - Editor: Open Kebab Menu · AI Assistant - Chat History: Click menu · Profile - Running Against: Click Edit · Profile - Top Issues: Cancel Edit · Pro Upgrade - Committee Check Page: Click Upload · Click to Call Phone Submitted · Click to Call CTA Clicked · Briefing Assistant - Dictation Started · Briefing Assistant - Agenda Submission Failed

### Changes since last run

- new: 17 (see flagged table)
- escalated: Serve Onboarding - Magic Link Activated, Serve Onboarding - Magic Link Sent, Win Onboarding - Magic Link Sent
- resolved: 19 (see flagged table)
- still open: 42 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 443/467 (95%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): Onboarding V2 - Campaign Story Skipped · Onboarding V2 - Campaign Story Viewed · Voter Outreach - 10DLC Compliance PIN Sent
- Other non-system events missing a description: 21 (not listed).

### Watchlist proposals (self-healing)

104 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Voter Outreach - 10DLC Compliance PIN Resent", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Onboarding V2 - Campaign Story Viewed", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Onboarding V2 - Campaign Story Skipped", product: win, family: win_onboarding, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Briefing Assistant - Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Voter Outreach - 10DLC Compliance Candidate Profile Submitted", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Pro Upgrade - Filing Details Submit Error", product: win, family: win_pro_upgrade, floor: null, owner: TBD}
  - {event: "Community Issues - Ask AI Started", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Prioritize Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Dashboard - Campaign Plan: Plan Shared", product: win, family: win_dashboard, floor: null, owner: TBD}
  - {event: "Community Issues - Run Poll Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Confirm Viewed", product: serve, family: serve, floor: null, owner: TBD}
```
(89 more — see the JSON report.)

## 2026-07-23

Basis: complete weeks before 2026-07-20. 513 events — active 337, deprecating 67, system 39, dormant 26, instrumented_never_observed 23, retired 20, code_unknown 1. 64 flagged (40 priority, 24 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Settings - Personal Info: Click Upload | active |  | 30d=15; last_seen 2026-07-22 | declared not-in-use but still firing |
| 4 anomaly drop, active | Navigation - Dashboard: Click Voter Data | active |  | 30d=69; week 1 vs base 41.5; last_seen 2026-07-18 |  |
| 4 anomaly drop, active | Voter Data: Click Detail View | active |  | 30d=60; week 1 vs base 35.0; last_seen 2026-07-18 |  |
| 4 anomaly drop, active | Voter Data - File Detail: Click Custom File Info Icon | active |  | 30d=2; week 1 vs base 30.8; last_seen 2026-06-30 |  |
| 5 intent divergence | Community Issues - High Priority Trending Issue Created | deprecating |  | 30d=70; last_seen 2026-07-14; PR https://github.com/thegoodparty/omni/pull/437 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Requested | deprecating |  | 30d=65; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Displayed | deprecating |  | 30d=53; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Results Received | deprecating |  | 30d=53; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Profile - Why Running: Click Save | deprecating |  | 30d=28; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Profile - Policy Priorities: Click Save | deprecating |  | 30d=15; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Activated | deprecating | yes | 30d=14; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Sent | deprecating | yes | 30d=3; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Win Onboarding - Magic Link Sent | deprecating | yes | 30d=1; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/318 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Viewed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Completed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 6 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 6 dormant (elevated) | Serve Onboarding - SMS Poll Creation Failed | dormant | yes | 30d=0; last_seen 2026-06-17; PR https://github.com/thegoodparty/omni/pull/1374 |  |
| 7 instrumented, never observed | Community Issues - Dispatch Skipped | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/701 |  |
| 7 instrumented, never observed | Constituent Data - Activity List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Constituent Data - Contact Searched | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Constituent Data - Contact Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Constituent Data - List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Constituent Data - List Exported | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Constituent Data - Note Added | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Contacts - Assistant Chat Opened | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Contacts - Assistant Message Sent | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Contacts - List Wizard Conditions Completed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Contacts - List Wizard Conditions Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Contacts - List Wizard Method Completed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Contacts - List Wizard Method Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Contacts - List Wizard Name Completed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Contacts - List Wizard Name Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - Activity List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Voter Data - Contact Searched | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - Contact Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - Note Added | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - Send Outreach Clicked | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Outreach - 10DLC Compliance Rejected | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/974 |  |
| 7 instrumented, never observed | Win - Opponent Activity Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Self Research Completed | instrumented_never_observed |  | 30d=0 |  |

**Dormant tail (24)** — code present, 0 fires/30d, not elevated: Account - Password Reset Requested · Account - Pro Subscription Confirmed · Settings - Delete Account: Cancel Delete · Pro user can not download voter file page · Click to Call CTA Viewed · Voter Data - Need Help: Submit · Profile - Running Against: Cancel Edit · Voter Data - File Detail - Learn & Take Action: Click Read More · Navigation - Dashboard: Click Community · Download Voter File Failure · AI Assistant - Chat History: Click delete · schedule_campaign_image_too_large · Polls - Poll Preview Completed · Profile - Running Against: Submit Edit · Payment - Schedule and Pay Viewed · Voter Data - Need Help: Select Voter File type · AI Assistant - Chat: Click thumbs down · Content Builder - Editor: Open Kebab Menu · AI Assistant - Chat History: Click menu · Profile - Running Against: Click Edit · Profile - Top Issues: Cancel Edit · Pro Upgrade - Committee Check Page: Click Upload · Click to Call Phone Submitted · Click to Call CTA Clicked

### Changes since last run

- new: Contacts - Assistant Chat Opened, Contacts - Assistant Message Sent, Contacts - List Wizard Conditions Completed, Contacts - List Wizard Conditions Viewed, Contacts - List Wizard Method Completed, Contacts - List Wizard Method Viewed, Contacts - List Wizard Name Completed, Contacts - List Wizard Name Viewed, Pro user can not download voter file page, Voter Data - Need Help: Select Voter File type, Voter Data - Send Outreach Clicked, Voter Outreach - 10DLC Compliance Rejected
- escalated: none
- resolved: Payment - Completed, Payment - Review and Pay Screen Viewed, Polls - Expand Poll Recommendations Completed, Polls - Expand Poll Recommendations Viewed, Polls - Expand Poll Review Viewed, Settings - Delete Account: Click Delete, Settings - Delete Account: Submit Delete, Sign Up: Click Login, Voter Data - List Created, Voter Data - List Exported, Voter Outreach - 10DLC Compliance PIN Resent, [Experiment] Exposure
- still open: 52 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 430/451 (95%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): Voter Outreach - 10DLC Compliance PIN Sent
- Other non-system events missing a description: 20 (not listed).

### Watchlist proposals (self-healing)

105 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Voter Outreach - 10DLC Compliance PIN Resent", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Briefing Assistant - Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Voter Outreach - 10DLC Compliance Candidate Profile Submitted", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Pro Upgrade - Filing Details Submit Error", product: win, family: win_pro_upgrade, floor: null, owner: TBD}
  - {event: "Community Issues - Ask AI Started", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Prioritize Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Dashboard - Campaign Plan: Plan Shared", product: win, family: win_dashboard, floor: null, owner: TBD}
  - {event: "Community Issues - Run Poll Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Confirm Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - List Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Issue Detail Viewed", product: serve, family: serve, floor: null, owner: TBD}
```
(90 more — see the JSON report.)

## 2026-07-20

Basis: complete weeks before 2026-07-20. 503 events — active 328, deprecating 67, system 39, dormant 32, retired 20, instrumented_never_observed 16, code_unknown 1. 64 flagged (35 priority, 29 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Settings - Personal Info: Click Upload | active |  | 30d=9; last_seen 2026-07-18 | declared not-in-use but still firing |
| 4 anomaly drop, active | [Experiment] Exposure | active |  | 30d=172895; week 2354 vs base 54012.5; last_seen 2026-07-19 |  |
| 4 anomaly drop, active | Navigation - Dashboard: Click Voter Data | active |  | 30d=90; week 1 vs base 41.5; last_seen 2026-07-18 |  |
| 4 anomaly drop, active | Voter Data: Click Detail View | active |  | 30d=78; week 1 vs base 35.0; last_seen 2026-07-18 |  |
| 4 anomaly drop, active | Voter Data - File Detail: Click Custom File Info Icon | active |  | 30d=6; week 1 vs base 30.8; last_seen 2026-06-30 |  |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Requested | deprecating |  | 30d=92; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Displayed | deprecating |  | 30d=80; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Results Received | deprecating |  | 30d=80; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Community Issues - High Priority Trending Issue Created | deprecating |  | 30d=70; last_seen 2026-07-14; PR https://github.com/thegoodparty/omni/pull/437 | declared in-use but code removed + quiet |
| 5 intent divergence | Profile - Why Running: Click Save | deprecating |  | 30d=30; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Activated | deprecating | yes | 30d=16; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Profile - Policy Priorities: Click Save | deprecating |  | 30d=15; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Sent | deprecating | yes | 30d=3; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Win Onboarding - Magic Link Sent | deprecating | yes | 30d=1; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/318 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Viewed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Completed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 6 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 6 dormant (elevated) | Serve Onboarding - SMS Poll Creation Failed | dormant | yes | 30d=0; last_seen 2026-06-17; PR https://github.com/thegoodparty/omni/pull/1374 |  |
| 6 dormant (elevated) | Sign Up: Click Login | dormant | yes | 30d=0; last_seen 2026-04-20 |  |
| 7 instrumented, never observed | Community Issues - Dispatch Skipped | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/701 |  |
| 7 instrumented, never observed | Constituent Data - Activity List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Constituent Data - Contact Searched | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Constituent Data - Contact Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Constituent Data - List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Constituent Data - List Exported | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Constituent Data - Note Added | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - Activity List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Voter Data - Contact Searched | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - Contact Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - List Created | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Voter Data - List Exported | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/852 |  |
| 7 instrumented, never observed | Voter Data - Note Added | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Outreach - 10DLC Compliance PIN Resent | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/854 |  |
| 7 instrumented, never observed | Win - Opponent Activity Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Self Research Completed | instrumented_never_observed |  | 30d=0 |  |

**Dormant tail (29)** — code present, 0 fires/30d, not elevated: Account - Password Reset Requested · Account - Pro Subscription Confirmed · Settings - Delete Account: Cancel Delete · Payment - Completed · Settings - Delete Account: Submit Delete · Voter Data - Need Help: Submit · Profile - Running Against: Cancel Edit · Voter Data - File Detail - Learn & Take Action: Click Read More · Settings - Delete Account: Click Delete · Polls - Expand Poll Recommendations Completed · Navigation - Dashboard: Click Community · Download Voter File Failure · AI Assistant - Chat History: Click delete · schedule_campaign_image_too_large · Polls - Poll Preview Completed · Profile - Running Against: Submit Edit · Polls - Expand Poll Recommendations Viewed · Payment - Schedule and Pay Viewed · Polls - Expand Poll Review Viewed · AI Assistant - Chat: Click thumbs down · Payment - Review and Pay Screen Viewed · AI Assistant - Chat History: Click menu · Profile - Running Against: Click Edit · Profile - Top Issues: Cancel Edit · Pro Upgrade - Committee Check Page: Click Upload · Click to Call CTA Viewed · Click to Call Phone Submitted · Click to Call CTA Clicked · Content Builder - Editor: Open Kebab Menu

### Changes since last run

- new: 21 (see flagged table)
- escalated: none
- resolved: none
- still open: 43 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 428/448 (96%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): Voter Outreach - 10DLC Compliance PIN Sent
- Other non-system events missing a description: 19 (not listed).

### Watchlist proposals (self-healing)

106 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Community Issues - Trending Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Briefing Assistant - Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Voter Outreach - 10DLC Compliance Candidate Profile Submitted", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Pro Upgrade - Filing Details Submit Error", product: win, family: win_pro_upgrade, floor: null, owner: TBD}
  - {event: "Community Issues - Ask AI Started", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Prioritize Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Dashboard - Campaign Plan: Plan Shared", product: win, family: win_dashboard, floor: null, owner: TBD}
  - {event: "Community Issues - Run Poll Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Confirm Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - List Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Issue Detail Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Initial Issues Generated", product: serve, family: serve, floor: null, owner: TBD}
```
(91 more — see the JSON report.)

## 2026-07-17

Basis: complete weeks before 2026-07-13. 492 events — active 327, deprecating 69, system 39, dormant 25, retired 20, code_unknown 7, instrumented_never_observed 5. 43 flagged (19 priority, 24 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Settings - Personal Info: Click Upload | active |  | 30d=4; last_seen 2026-07-16 | declared not-in-use but still firing |
| 4 anomaly drop, active | [Experiment] Exposure | active |  | 30d=207435; week 2245 vs base 64828.0; last_seen 2026-07-16 |  |
| 4 anomaly drop, active | Voter Data - File Detail: Click Custom File Info Icon | active |  | 30d=7; week 1 vs base 30.8; last_seen 2026-06-30 |  |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Requested | deprecating |  | 30d=135; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Displayed | deprecating |  | 30d=123; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Dashboard - Campaign Plan: Community Events Results Received | deprecating |  | 30d=123; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 | declared in-use but code removed + quiet |
| 5 intent divergence | Profile - Why Running: Click Save | deprecating |  | 30d=36; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Activated | deprecating | yes | 30d=17; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Profile - Policy Priorities: Click Save | deprecating |  | 30d=15; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 | declared in-use but code removed + quiet |
| 5 intent divergence | Serve Onboarding - Magic Link Sent | deprecating | yes | 30d=3; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 | declared in-use but code removed + quiet |
| 5 intent divergence | Win Onboarding - Magic Link Sent | deprecating | yes | 30d=1; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/318 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Viewed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Completed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 6 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 7 instrumented, never observed | Community Issues - Dispatch Skipped | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/701 |  |
| 7 instrumented, never observed | Constituent Data - Contact Searched | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Voter Data - Contact Searched | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Opponent Activity Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Self Research Completed | instrumented_never_observed |  | 30d=0 |  |

**Dormant tail (24)** — code present, 0 fires/30d, not elevated: Account - Password Reset Requested · Account - Pro Subscription Confirmed · Voter Data - Need Help: Submit · Profile - Running Against: Cancel Edit · Voter Data - File Detail - Learn & Take Action: Click Read More · Polls - Expand Poll Recommendations Completed · Navigation - Dashboard: Click Community · Download Voter File Failure · AI Assistant - Chat History: Click delete · schedule_campaign_image_too_large · Polls - Poll Preview Completed · Profile - Running Against: Submit Edit · Payment - Schedule and Pay Viewed · AI Assistant - Chat: Click thumbs down · Content Builder - Editor: Open Kebab Menu · AI Assistant - Chat History: Click menu · Profile - Running Against: Click Edit · Profile - Top Issues: Cancel Edit · Payment - Completed · Polls - Expand Poll Review Viewed · Payment - Review and Pay Screen Viewed · Click to Call CTA Viewed · Click to Call Phone Submitted · Click to Call CTA Clicked

### Changes since last run

- new: Constituent Data - Contact Searched, Voter Data - Contact Searched
- escalated: Dashboard - Campaign Plan: Community Events Displayed, Dashboard - Campaign Plan: Community Events Requested, Dashboard - Campaign Plan: Community Events Results Received, Profile - Policy Priorities: Click Save, Profile - Why Running: Click Save, Serve Onboarding - Magic Link Activated, Serve Onboarding - Magic Link Sent, Win Onboarding - Magic Link Sent
- resolved: Account - Pro Subscription Canceled, Briefing Assistant - Dispatch Skipped, Navigation - Dashboard: Click Website, Navigation Top - Avatar Dropdown: Click Settings, Onboarding V2 - New Campaign Context Viewed, Pro Upgrade - Committee Check Page: Click back, Pro Upgrade - Committee Check Page: Click next, Pro Upgrade - Committee Check Page: Hover "Upload" help, Pro Upgrade - Service Agreement Page: Click finish, Pro Upgrade - Splash Page: Click upgrade, Pro Upgrade - Splash Page: Exit, Pro Upgrade: Click Go to Stripe, Pro Upgrade: Confirm office, Settings - Account Settings: Click Send Email, Settings - Personal Info: Click Save
- still open: 33 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 428/448 (96%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): Voter Outreach - 10DLC Compliance PIN Sent
- Other non-system events missing a description: 19 (not listed).

### Watchlist proposals (self-healing)

108 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Community Issues - Trending Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Briefing Assistant - Dispatch Skipped", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Voter Outreach - 10DLC Compliance Candidate Profile Submitted", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Pro Upgrade - Filing Details Submit Error", product: win, family: win_pro_upgrade, floor: null, owner: TBD}
  - {event: "Community Issues - Ask AI Started", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issue Priority Changed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Prioritize Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Dashboard - Campaign Plan: Plan Shared", product: win, family: win_dashboard, floor: null, owner: TBD}
  - {event: "Community Issues - Run Poll Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Confirm Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - List Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Issue Detail Viewed", product: serve, family: serve, floor: null, owner: TBD}
```
(93 more — see the JSON report.)

## 2026-07-16

Basis: complete weeks before 2026-07-13. 488 events — active 326, deprecating 47, system 39, dormant 25, orphaned_firing 22, retired 20, code_unknown 5, instrumented_never_observed 4. 56 flagged (32 priority, 24 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Dashboard - Campaign Plan: Community Events Requested | orphaned_firing |  | 30d=138; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 |  |
| 1 orphaned-firing / not-in-use still firing | Dashboard - Campaign Plan: Community Events Displayed | orphaned_firing |  | 30d=126; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 |  |
| 1 orphaned-firing / not-in-use still firing | Dashboard - Campaign Plan: Community Events Results Received | orphaned_firing |  | 30d=126; last_seen 2026-06-27; PR https://github.com/thegoodparty/omni/pull/54 |  |
| 1 orphaned-firing / not-in-use still firing | Settings - Personal Info: Click Save | orphaned_firing |  | 30d=62; last_seen 2026-07-07 |  |
| 1 orphaned-firing / not-in-use still firing | Navigation - Dashboard: Click Website | orphaned_firing |  | 30d=58; last_seen 2026-06-25 |  |
| 1 orphaned-firing / not-in-use still firing | Profile - Why Running: Click Save | orphaned_firing |  | 30d=37; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 |  |
| 1 orphaned-firing / not-in-use still firing | Serve Onboarding - Magic Link Activated | orphaned_firing | yes | 30d=17; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 |  |
| 1 orphaned-firing / not-in-use still firing | Profile - Policy Priorities: Click Save | orphaned_firing |  | 30d=16; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/1778 |  |
| 1 orphaned-firing / not-in-use still firing | Pro Upgrade - Splash Page: Click upgrade | orphaned_firing | yes | 30d=11; last_seen 2026-06-18 |  |
| 1 orphaned-firing / not-in-use still firing | Pro Upgrade - Committee Check Page: Hover "Upload" help | orphaned_firing |  | 30d=10; last_seen 2026-06-18; PR https://github.com/thegoodparty/omni/pull/1132 |  |
| 1 orphaned-firing / not-in-use still firing | Pro Upgrade: Confirm office | orphaned_firing |  | 30d=9; last_seen 2026-06-18 |  |
| 1 orphaned-firing / not-in-use still firing | Settings - Account Settings: Click Send Email | orphaned_firing |  | 30d=7; last_seen 2026-07-02 |  |
| 1 orphaned-firing / not-in-use still firing | Onboarding V2 - New Campaign Context Viewed | orphaned_firing | yes | 30d=6; last_seen 2026-06-25; PR https://github.com/thegoodparty/omni/pull/151 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Account - Pro Subscription Canceled | orphaned_firing |  | 30d=5; last_seen 2026-07-07; PR https://github.com/thegoodparty/omni/pull/920 |  |
| 1 orphaned-firing / not-in-use still firing | Pro Upgrade - Committee Check Page: Click next | orphaned_firing |  | 30d=4; last_seen 2026-06-18 |  |
| 1 orphaned-firing / not-in-use still firing | Pro Upgrade - Service Agreement Page: Click finish | orphaned_firing |  | 30d=3; last_seen 2026-06-18 |  |
| 1 orphaned-firing / not-in-use still firing | Settings - Personal Info: Click Upload | active |  | 30d=3; last_seen 2026-07-13 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Serve Onboarding - Magic Link Sent | orphaned_firing | yes | 30d=3; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 |  |
| 1 orphaned-firing / not-in-use still firing | Pro Upgrade - Splash Page: Exit | orphaned_firing |  | 30d=2; last_seen 2026-06-16 |  |
| 1 orphaned-firing / not-in-use still firing | Pro Upgrade - Committee Check Page: Click back | orphaned_firing |  | 30d=2; last_seen 2026-06-17 |  |
| 1 orphaned-firing / not-in-use still firing | Pro Upgrade: Click Go to Stripe | orphaned_firing |  | 30d=1; last_seen 2026-06-18 |  |
| 1 orphaned-firing / not-in-use still firing | Navigation Top - Avatar Dropdown: Click Settings | orphaned_firing |  | 30d=1; last_seen 2026-06-22 |  |
| 1 orphaned-firing / not-in-use still firing | Win Onboarding - Magic Link Sent | orphaned_firing | yes | 30d=1; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/318 |  |
| 4 anomaly drop, active | [Experiment] Exposure | active |  | 30d=212319; week 2245 vs base 64828.0; last_seen 2026-07-15 |  |
| 4 anomaly drop, active | Voter Data - File Detail: Click Custom File Info Icon | active |  | 30d=7; week 1 vs base 30.8; last_seen 2026-06-30 |  |
| 5 intent divergence | Onboarding V2 - Resources Viewed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 5 intent divergence | Onboarding V2 - Resources Completed | deprecating | yes | 30d=0; last_seen 2026-06-10; PR https://github.com/thegoodparty/omni/pull/2002 | declared in-use but code removed + quiet |
| 6 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 7 instrumented, never observed | Briefing Assistant - Dispatch Skipped | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/701 |  |
| 7 instrumented, never observed | Community Issues - Dispatch Skipped | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/701 |  |
| 7 instrumented, never observed | Win - Opponent Activity Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Self Research Completed | instrumented_never_observed |  | 30d=0 |  |

**Dormant tail (24)** — code present, 0 fires/30d, not elevated: Account - Password Reset Requested · Account - Pro Subscription Confirmed · Payment - Completed · Click to Call CTA Viewed · Voter Data - Need Help: Submit · Profile - Running Against: Cancel Edit · Voter Data - File Detail - Learn & Take Action: Click Read More · Polls - Expand Poll Recommendations Completed · Navigation - Dashboard: Click Community · Download Voter File Failure · AI Assistant - Chat History: Click delete · schedule_campaign_image_too_large · Polls - Poll Preview Completed · Profile - Running Against: Submit Edit · Payment - Schedule and Pay Viewed · Polls - Expand Poll Review Viewed · AI Assistant - Chat: Click thumbs down · Payment - Review and Pay Screen Viewed · AI Assistant - Chat History: Click menu · Profile - Running Against: Click Edit · Profile - Top Issues: Cancel Edit · Click to Call Phone Submitted · Click to Call CTA Clicked · Content Builder - Editor: Open Kebab Menu

### Changes since last run

- new: 21 (see flagged table)
- escalated: Onboarding V2 - New Campaign Context Viewed, Onboarding V2 - Resources Completed, Onboarding V2 - Resources Viewed
- resolved: 43 (see flagged table)
- still open: 32 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 428/445 (96%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): Voter Outreach - 10DLC Compliance PIN Sent
- Other non-system events missing a description: 16 (not listed).

### Watchlist proposals (self-healing)

105 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Voter Outreach - 10DLC Compliance Candidate Profile Submitted", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Community Issues - Trending Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issues Refreshed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Pro Upgrade - Filing Details Submit Error", product: win, family: win_pro_upgrade, floor: null, owner: TBD}
  - {event: "Community Issues - Ask AI Started", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Top Issue Priority Changed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Prioritize Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Dashboard - Campaign Plan: Plan Shared", product: win, family: win_dashboard, floor: null, owner: TBD}
  - {event: "Community Issues - Run Poll Clicked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Confirm Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - List Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Issue Detail Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - Initial Issues Generated", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Community Issues - High Priority Trending Issue Created", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Pledge Viewed", product: serve, family: serve, floor: null, owner: TBD}
```
(90 more — see the JSON report.)

## 2026-07-13

Basis: complete weeks before 2026-07-13. 479 events — active 347, dormant 67, system 39, retired 20, orphaned_firing 3, instrumented_never_observed 2, code_unknown 1. 78 flagged (56 priority, 22 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Serve Onboarding - Magic Link Activated | orphaned_firing | yes | 30d=17; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 |  |
| 1 orphaned-firing / not-in-use still firing | Onboarding V2 - New Campaign Context Viewed | active | yes | 30d=7; last_seen 2026-06-25; call_sites=0 (removed 2026-06-25); PR https://github.com/thegoodparty/omni/pull/151 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Serve Onboarding - Magic Link Sent | orphaned_firing | yes | 30d=3; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 |  |
| 1 orphaned-firing / not-in-use still firing | Dashboard - Candidate Dashboard Viewed | active | yes | 30d=2; last_seen 2026-06-13; call_sites=0 (removed 2026-06-11); PR https://github.com/thegoodparty/omni/pull/708 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Settings - Personal Info: Click Upload | active |  | 30d=2; last_seen 2026-07-09 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Win Onboarding - Magic Link Sent | orphaned_firing | yes | 30d=1; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/318 |  |
| 1 orphaned-firing / not-in-use still firing | Onboarding V2 - New Campaign Context Completed | active | yes | 30d=1; last_seen 2026-06-15; call_sites=0 (removed 2026-06-25); PR https://github.com/thegoodparty/omni/pull/151 | declared not-in-use but still firing |
| 2 call site removed, name constant remains | Settings - Delete Account: Cancel Delete | dormant |  | 30d=0; last_seen 2026-04-01; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Onboarding - Path To Victory Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 |  |
| 2 call site removed, name constant remains | Onboarding - Party Step: Click Submit | dormant | yes | 30d=0; last_seen 2026-05-07; call_sites=0 (removed 2026-05-05) |  |
| 2 call site removed, name constant remains | Settings - Delete Account: Click Delete | dormant |  | 30d=0; last_seen 2026-04-17; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Onboarding - Pledge Step: Click Submit | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09) |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Submit Edit | dormant |  | 30d=0; last_seen 2026-06-04; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Onboarding: Click Finish Later | dormant | yes | 30d=0; last_seen 2026-05-06; call_sites=0 (removed 2026-05-05) |  |
| 2 call site removed, name constant remains | Set Password: Click Set Password | dormant |  | 30d=0; last_seen 2026-04-16; call_sites=0 (removed 2026-04-16); PR https://github.com/thegoodparty/omni/pull/513 |  |
| 2 call site removed, name constant remains | Onboarding - Candidate Affiliation Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/920 |  |
| 2 call site removed, name constant remains | Onboarding - Office Selection Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Click Edit | dormant |  | 30d=0; last_seen 2026-06-06; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Sign In: Click Create Account | dormant |  | 30d=0; last_seen 2026-04-20; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Account - Password Reset Completed | dormant |  | 30d=0; last_seen 2026-04-20; call_sites=0 (removed 2026-04-16); PR https://github.com/thegoodparty/omni/pull/710 |  |
| 2 call site removed, name constant remains | Onboarding - Pledge Step: Click Ask a Question | dormant | yes | 30d=0; last_seen 2025-08-18; call_sites=0 (removed 2025-08-15) |  |
| 2 call site removed, name constant remains | Onboarding - Welcome Completed | dormant | yes | 30d=0; last_seen 2026-06-08; call_sites=0 (removed 2026-06-08); PR https://github.com/thegoodparty/omni/pull/1790 |  |
| 2 call site removed, name constant remains | Sign Up: Click Login | dormant | yes | 30d=0; last_seen 2026-04-20; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Onboarding - Candidate Pledge Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/920 |  |
| 2 call site removed, name constant remains | Onboarding - Ballot Status Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 |  |
| 2 call site removed, name constant remains | Pro Upgrade - Committee Check Page: Hover "Name of Campaign Committee" help | dormant |  | 30d=0; last_seen 2026-06-12; call_sites=0 (removed 2026-06-19); PR https://github.com/thegoodparty/omni/pull/1132 |  |
| 2 call site removed, name constant remains | Schedule Text Campaign: Submit | dormant | yes | 30d=0; last_seen 2025-06-24; call_sites=0 (removed 2025-06-13) |  |
| 2 call site removed, name constant remains | Onboarding - Path To Victory Updated | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 |  |
| 2 call site removed, name constant remains | Profile - Why Section: Click Save | dormant |  | 30d=0; last_seen 2026-06-06; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Click Finish Entering Issues | dormant |  | 30d=0; last_seen 2026-06-07; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Onboarding - Party Selection Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 |  |
| 2 call site removed, name constant remains | Navigation - Dashboard: Click Issues | dormant |  | 30d=0; last_seen 2025-10-03; call_sites=0 (removed 2025-10-08); PR https://github.com/thegoodparty/omni/pull/733 |  |
| 2 call site removed, name constant remains | Profile - Fun Fact: Click Save | dormant |  | 30d=0; last_seen 2026-06-07; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Account - Password Set Completed | dormant |  | 30d=0; last_seen 2026-03-05; call_sites=0 (removed 2026-04-16); PR https://github.com/thegoodparty/omni/pull/888 |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Submit Delete | dormant |  | 30d=0; last_seen 2026-05-11; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Onboarding - Know Your Voters Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1804 |  |
| 2 call site removed, name constant remains | Sign In: Click Forgot Password | dormant |  | 30d=0; last_seen 2026-04-20; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Account - Password Reset Requested | dormant |  | 30d=0; last_seen 2026-04-20; call_sites=0; PR https://github.com/thegoodparty/omni/pull/710 |  |
| 2 call site removed, name constant remains | Settings - Delete Account: Submit Delete | dormant |  | 30d=0; last_seen 2026-04-17; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Onboarding - Pledge Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Cancel Delete | dormant |  | 30d=0; last_seen 2026-02-03; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Onboarding - Complete Step: Click Go to Dashboard | dormant | yes | 30d=0; last_seen 2026-05-07; call_sites=0 (removed 2026-05-05) |  |
| 2 call site removed, name constant remains | Settings - Password: Click Save | dormant |  | 30d=0; last_seen 2026-04-16; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Click Delete | dormant |  | 30d=0; last_seen 2026-05-11; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Pro Upgrade - Service Agreement Page: Click back | dormant |  | 30d=0; last_seen 2026-05-25; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Pro Upgrade - Committee Check Page: Toggle EIN requirement | dormant |  | 30d=0; last_seen 2026-03-12; call_sites=0 (removed 2026-03-11) |  |
| 2 call site removed, name constant remains | Onboarding - Path To Victory Errored | dormant | yes | 30d=0; last_seen 2026-06-07; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 |  |
| 2 call site removed, name constant remains | Onboarding V2 - Resources Viewed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0; PR https://github.com/thegoodparty/omni/pull/2002 |  |
| 2 call site removed, name constant remains | Onboarding V2 - Resources Completed | dormant | yes | 30d=0; last_seen 2026-06-10; call_sites=0 (removed 2026-06-10); PR https://github.com/thegoodparty/omni/pull/2002 |  |
| 2 call site removed, name constant remains | Contacts - Column Edited | dormant |  | 30d=0; last_seen 2025-12-18; call_sites=0 (removed 2026-02-08); PR https://github.com/thegoodparty/omni/pull/958 |  |
| 4 anomaly drop, active | [Experiment] Exposure | active |  | 30d=224345; week 2163 vs base 64828.0; last_seen 2026-07-12 |  |
| 4 anomaly drop, active | Voter Data - File Detail: Click Custom File Info Icon | active |  | 30d=8; week 1 vs base 30.8; last_seen 2026-06-30 |  |
| 6 dormant (elevated) | Onboarding - Registration Completed | dormant | yes | 30d=0; last_seen 2026-04-20; PR https://github.com/thegoodparty/omni/pull/708 |  |
| 6 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 7 instrumented, never observed | Win - Opponent Activity Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Self Research Completed | instrumented_never_observed |  | 30d=0 |  |

**Dormant tail (22)** — code present, 0 fires/30d, not elevated: Account - Pro Subscription Confirmed · Navigation - Dashboard: Click Community · schedule_campaign_image_too_large · Profile - Running Against: Click Edit · Voter Data - Need Help: Submit · Download Voter File Failure · Profile - Running Against: Submit Edit · AI Assistant - Chat: Click thumbs down · AI Assistant - Chat History: Click menu · Profile - Top Issues: Cancel Edit · Click to Call CTA Viewed · Profile - Running Against: Cancel Edit · AI Assistant - Chat History: Click delete · Polls - Expand Poll Recommendations Completed · Polls - Poll Preview Completed · Payment - Schedule and Pay Viewed · Payment - Completed · Polls - Expand Poll Review Viewed · Payment - Review and Pay Screen Viewed · Content Builder - Editor: Open Kebab Menu · Click to Call CTA Clicked · Click to Call Phone Submitted

### Changes since last run

- new: 17 (see flagged table)
- escalated: Onboarding - Ballot Status Completed, Onboarding - Candidate Affiliation Completed, Onboarding - Candidate Pledge Completed, Onboarding - Know Your Voters Completed, Onboarding - Office Selection Completed, Onboarding - Party Selection Completed, Onboarding - Path To Victory Completed, Onboarding - Path To Victory Errored, Onboarding - Path To Victory Updated, Onboarding - Pledge Completed, Onboarding - Welcome Completed, Settings - Personal Info: Click Upload
- resolved: 10 DLC Compliance - Registration Submitted, Content Builder - Editor: Submit Translate, Profile - Candidate Profile: Submit Success, Profile - Running Against: Click Delete, Win - Opponent Profile Viewed, Win - Opponent Research Started, Win - Opponent Upgrade Viewed, Win - Opponents Manually Added
- still open: 49 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 428/438 (98%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): none
- Other non-system events missing a description: 10 (not listed).

### Watchlist proposals (self-healing)

56 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Voter Outreach - 10DLC Compliance PIN Sent", product: win, family: win_voter_outreach, floor: null, owner: TBD}
  - {event: "Dashboard - Campaign Plan: Plan Shared", product: win, family: win_dashboard, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Confirm Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Pledge Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Pledge Completed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Party Designation Blocked", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Know Your Constituents Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Know Your Constituents Completed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Welcome Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Term Dates Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Party Designation Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Office Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Office Status Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Office Completed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Onboarding - Magic Link Sent", product: win, family: win_onboarding, floor: null, owner: TBD}
```
(41 more — see the JSON report.)

## 2026-07-01

Basis: complete weeks before 2026-06-29. 473 events — active 361, dormant 43, system 39, retired 18, instrumented_never_observed 6, orphaned_firing 5, code_unknown 1. 69 flagged (52 priority, 17 dormant tail).

### Flagged (ranked)

| rank | event | status | elev | evidence | divergence |
| --- | --- | --- | --- | --- | --- |
| 1 orphaned-firing / not-in-use still firing | Dashboard - Candidate Dashboard Viewed | active | yes | 30d=3861; last_seen 2026-06-13; call_sites=0 (removed 2026-06-11); PR https://github.com/thegoodparty/omni/pull/708 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Ballot Status Completed | active | yes | 30d=220; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Party Selection Completed | active | yes | 30d=193; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Candidate Affiliation Completed | active | yes | 30d=193; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/920 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Welcome Completed | active | yes | 30d=189; last_seen 2026-06-08; call_sites=0 (removed 2026-06-08); PR https://github.com/thegoodparty/omni/pull/1790 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Office Selection Completed | active | yes | 30d=157; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Pledge Completed | active | yes | 30d=146; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Candidate Pledge Completed | active | yes | 30d=146; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/920 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Path To Victory Updated | active | yes | 30d=141; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Path To Victory Completed | active | yes | 30d=138; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Know Your Voters Completed | active | yes | 30d=132; last_seen 2026-06-10; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1804 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Serve Onboarding - Magic Link Activated | orphaned_firing | yes | 30d=17; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 |  |
| 1 orphaned-firing / not-in-use still firing | Onboarding - Path To Victory Errored | active | yes | 30d=7; last_seen 2026-06-07; call_sites=0 (removed 2026-06-09); PR https://github.com/thegoodparty/omni/pull/1790 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Onboarding V2 - New Campaign Context Viewed | active | yes | 30d=7; last_seen 2026-06-25; call_sites=0 (removed 2026-06-25); PR https://github.com/thegoodparty/omni/pull/151 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | 10 DLC Compliance - Registration Submitted | orphaned_firing | yes | 30d=5; last_seen 2026-06-05; PR https://github.com/thegoodparty/omni/pull/1049 |  |
| 1 orphaned-firing / not-in-use still firing | Profile - Candidate Profile: Submit Success | orphaned_firing |  | 30d=3; last_seen 2026-06-05; PR https://github.com/thegoodparty/omni/pull/1769 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Serve Onboarding - Magic Link Sent | orphaned_firing | yes | 30d=3; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/198 |  |
| 1 orphaned-firing / not-in-use still firing | Onboarding V2 - New Campaign Context Completed | active | yes | 30d=1; last_seen 2026-06-15; call_sites=0 (removed 2026-06-25); PR https://github.com/thegoodparty/omni/pull/151 | declared not-in-use but still firing |
| 1 orphaned-firing / not-in-use still firing | Win Onboarding - Magic Link Sent | orphaned_firing | yes | 30d=1; last_seen 2026-06-24; PR https://github.com/thegoodparty/omni/pull/318 |  |
| 2 call site removed, name constant remains | Account - Password Reset Requested | dormant |  | 30d=0; last_seen 2026-04-20; call_sites=0; PR https://github.com/thegoodparty/omni/pull/710 |  |
| 2 call site removed, name constant remains | Sign In: Click Create Account | dormant |  | 30d=0; last_seen 2026-04-20; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Settings - Delete Account: Cancel Delete | dormant |  | 30d=0; last_seen 2026-04-01; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Account - Password Reset Completed | dormant |  | 30d=0; last_seen 2026-04-20; call_sites=0 (removed 2026-04-16); PR https://github.com/thegoodparty/omni/pull/710 |  |
| 2 call site removed, name constant remains | Settings - Delete Account: Submit Delete | dormant |  | 30d=0; last_seen 2026-04-17; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Schedule Text Campaign: Submit | dormant | yes | 30d=0; last_seen 2025-06-24; call_sites=0 (removed 2025-06-13) |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Cancel Delete | dormant |  | 30d=0; last_seen 2026-02-03; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Onboarding - Party Step: Click Submit | dormant | yes | 30d=0; last_seen 2026-05-07; call_sites=0 (removed 2026-05-05) |  |
| 2 call site removed, name constant remains | Onboarding - Complete Step: Click Go to Dashboard | dormant | yes | 30d=0; last_seen 2026-05-07; call_sites=0 (removed 2026-05-05) |  |
| 2 call site removed, name constant remains | Settings - Password: Click Save | dormant |  | 30d=0; last_seen 2026-04-16; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Settings - Delete Account: Click Delete | dormant |  | 30d=0; last_seen 2026-04-17; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Onboarding - Pledge Step: Click Ask a Question | dormant | yes | 30d=0; last_seen 2025-08-18; call_sites=0 (removed 2025-08-15) |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Click Delete | dormant |  | 30d=0; last_seen 2026-05-11; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Navigation - Dashboard: Click Issues | dormant |  | 30d=0; last_seen 2025-10-03; call_sites=0 (removed 2025-10-08); PR https://github.com/thegoodparty/omni/pull/733 |  |
| 2 call site removed, name constant remains | Onboarding: Click Finish Later | dormant | yes | 30d=0; last_seen 2026-05-06; call_sites=0 (removed 2026-05-05) |  |
| 2 call site removed, name constant remains | Account - Password Set Completed | dormant |  | 30d=0; last_seen 2026-03-05; call_sites=0 (removed 2026-04-16); PR https://github.com/thegoodparty/omni/pull/888 |  |
| 2 call site removed, name constant remains | Set Password: Click Set Password | dormant |  | 30d=0; last_seen 2026-04-16; call_sites=0 (removed 2026-04-16); PR https://github.com/thegoodparty/omni/pull/513 |  |
| 2 call site removed, name constant remains | Profile - Top Issues: Submit Delete | dormant |  | 30d=0; last_seen 2026-05-11; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Pro Upgrade - Service Agreement Page: Click back | dormant |  | 30d=0; last_seen 2026-05-25; call_sites=0 (removed 2026-06-19) |  |
| 2 call site removed, name constant remains | Pro Upgrade - Committee Check Page: Toggle EIN requirement | dormant |  | 30d=0; last_seen 2026-03-12; call_sites=0 (removed 2026-03-11) |  |
| 2 call site removed, name constant remains | Sign In: Click Forgot Password | dormant |  | 30d=0; last_seen 2026-04-20; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Settings - Personal Info: Click Upload | dormant |  | 30d=0; last_seen 2026-04-19; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Sign Up: Click Login | dormant | yes | 30d=0; last_seen 2026-04-20; call_sites=0 (removed 2026-04-16) |  |
| 2 call site removed, name constant remains | Contacts - Column Edited | dormant |  | 30d=0; last_seen 2025-12-18; call_sites=0 (removed 2026-02-08); PR https://github.com/thegoodparty/omni/pull/958 |  |
| 4 anomaly drop, active | Voter Data - File Detail: Click Custom File Info Icon | active |  | 30d=124; week 1 vs base 59.0; last_seen 2026-06-30 |  |
| 6 dormant (elevated) | Onboarding - User Created | dormant | yes | 30d=0; last_seen 2026-04-17; PR https://github.com/thegoodparty/omni/pull/319 |  |
| 6 dormant (elevated) | Onboarding - Registration Completed | dormant | yes | 30d=0; last_seen 2026-04-20; PR https://github.com/thegoodparty/omni/pull/708 |  |
| 7 instrumented, never observed | Win - Opponent Activity Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Opponent Profile Viewed | instrumented_never_observed |  | 30d=0 |  |
| 7 instrumented, never observed | Win - Opponent Research Started | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/557 |  |
| 7 instrumented, never observed | Win - Opponent Upgrade Viewed | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/557 |  |
| 7 instrumented, never observed | Win - Opponents Manually Added | instrumented_never_observed |  | 30d=0; PR https://github.com/thegoodparty/omni/pull/557 |  |
| 7 instrumented, never observed | Win - Self Research Completed | instrumented_never_observed |  | 30d=0 |  |

**Dormant tail (17)** — code present, 0 fires/30d, not elevated: Account - Pro Subscription Confirmed · Click to Call CTA Viewed · Profile - Running Against: Click Delete · Profile - Running Against: Cancel Edit · Navigation - Dashboard: Click Community · Download Voter File Failure · AI Assistant - Chat History: Click delete · schedule_campaign_image_too_large · AI Assistant - Chat: Click thumbs down · AI Assistant - Chat History: Click menu · Content Builder - Editor: Submit Translate · Polls - Expand Poll Recommendations Completed · Click to Call Phone Submitted · Click to Call CTA Clicked · Polls - Expand Poll Review Viewed · Payment - Review and Pay Screen Viewed · Content Builder - Editor: Open Kebab Menu

### Changes since last run

- new: none
- escalated: none
- resolved: none
- still open: 69 event(s)

### Metadata completeness (description field)

- Non-system events with a description: 382/428 (89%). Remaining are blank pending the historical backfill.
- Onboarding / activation / compliance missing a description (fill first): Dashboard - Campaign Plan Generation Completed · Dashboard - Campaign Plan Viewed · Onboarding - Magic Link Clicked · Onboarding - Magic Link Sent · Serve Onboarding - Confirm Viewed · Serve Onboarding - Know Your Constituents Completed · Serve Onboarding - Know Your Constituents Viewed · Serve Onboarding - Office Completed · Serve Onboarding - Office Status Viewed · Serve Onboarding - Office Viewed · Serve Onboarding - Party Designation Blocked · Serve Onboarding - Party Designation Viewed · Serve Onboarding - Pledge Completed · Serve Onboarding - Pledge Viewed · Serve Onboarding - Term Dates Viewed · Serve Onboarding - Welcome Viewed · Sign Up Clicked · Win Onboarding - Magic Link Sent
- Other non-system events missing a description: 28 (not listed).

### Watchlist proposals (self-healing)

58 event(s) in a watched family, first seen in the last 90d, not yet on the watchlist. Triage in the runbook (add real funnel/activation milestones; skip UI micro-interactions), confirm in code, then paste the agreed rows into `monitored_events.yaml`:

```yaml
  - {event: "Serve Onboarding - Confirm Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Pledge Viewed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Pledge Completed", product: serve, family: serve, floor: null, owner: TBD}
  - {event: "Serve Onboarding - Party Designation Blocked", product: serve, family: serve, floor: null, owner: TBD}
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
```
(43 more — see the JSON report.)

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
