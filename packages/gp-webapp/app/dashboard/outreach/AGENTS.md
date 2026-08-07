# app/dashboard/outreach/

Voter outreach hub. Lets a campaign create text/voicemail/script outreach to voter audiences and tracks impact. Note: the directory is `outreach/` even though the tech design refers to it as "voter-outreach."

## Key files

| File | Role |
|------|------|
| `page.tsx` | Route entry — renders `OutreachPage` |
| `components/OutreachPage.tsx` | Top-level layout for the feature |
| `hooks/OutreachContext.tsx` | Feature-level context — current outreach selection, audience filters |
| `components/OutreachCreateCards.tsx` / `OutreachCreateCard.tsx` | Channel picker (text, voicemail, etc.) |
| `components/OutreachComposeDeepLink.tsx` | Consumes `?compose=text&message=<sms>` — opens the text TaskFlow with the preset script through the same gate as the create card, then strips the params (consume-once via `router.replace`) |
| `hooks/useTextOutreachGate.tsx` | Single source for the text-channel gate (non-Pro → `P2PUpgradeModal`, Pro non-compliant → `ComplianceModal`, else pass) — both the create card and the deep link call it |
| `components/OutreachActions.tsx` + `*ActionOption.tsx` | Per-channel actions (download audience, copy script) |
| `components/OutreachImpact.tsx` | Sent / delivered metrics |
| `hooks/` | Feature-local hooks (audience fetching, scheduling) |
| `util/` | Pure helpers — message templating, audience shaping |
| `constants.tsx` | Channel definitions, status labels |

## Patterns

- **Context-driven**: `OutreachContext` holds the selected outreach + audience. Components read from context rather than threading props through the action menus.
- **Action options compose**: each `*ActionOption.tsx` is a self-contained menu item (icon + label + handler). New channels = new option components, registered in `OutreachActions`.
- **Audience downloads** go through `helpers/createOutreach.ts` and `helpers/createP2pPhoneList.ts` — don't reinvent the file shape.

## Draft-first purchase flow (text/p2p)

The paid text flow persists the campaign BEFORE payment: entering the purchase
step in `components/tasks/flows/TaskFlow.tsx` creates the outreach with
`draft: true` (server stores it as `pending_payment`, hidden from
`GET /outreach`), and the draft's id rides in the checkout session metadata as
`outreachId`. The SERVER finalizes (Peerly + CAS Slack) during payment
completion — the client no longer POSTs the campaign after paying, it just
refetches the list. A tab that dies after payment loses nothing: the Stripe
webhook finalizes the draft on its own. Going back from the purchase step
discards the draft id; re-entry creates a fresh draft (stale ones stay hidden
server-side).

## Gotchas

- The `FreeTextsBanner` nag is part of free-tier gating — check `app/dashboard/shared/ProUpgradeModal.tsx` rules before changing it.
- Scheduled-send logic lives in `helpers/scheduleVoterMessagingCampaign.ts`, not in this dir.
- Status labels in `constants.tsx` are mirrored on gp-api — keep them in sync if either side changes.

## Related

- `helpers/createOutreach.ts`, `helpers/createP2pPhoneList.ts`, `helpers/scheduleVoterMessagingCampaign.ts`.
- `gpApi/outreach.api.ts` + `gpApi/types/outreach.types.ts` — shared shapes.
