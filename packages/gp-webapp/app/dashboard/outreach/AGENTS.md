# app/dashboard/outreach/

Voter outreach hub. Lets a campaign create text/voicemail/script/social outreach to voter audiences and tracks impact. Note: the directory is `outreach/` even though the tech design refers to it as "voter-outreach."

## Two surfaces, one flag

`page.tsx` (server component, fetches rows + compliance) renders
`v2/OutreachPageGate.tsx`, the single treatment/control divergence point on
the `voter-outreach-v2` flag (`@shared/experiments/voterOutreachV2Flag.ts`).
Flag on renders the v2 hub (`v2/`); flag off (or unsettled — respect `ready`)
renders the legacy `components/OutreachPage.tsx` unchanged. The two UIs never
mix; turning the flag off restores the legacy page exactly.

Inside the v2 hub, each channel's tile target is its own swap flag, so the
hub can ship with 100% legacy behavior underneath and channels flip
individually: `voter-outreach-v2-social`
(`@shared/experiments/voterOutreachV2SocialFlag.ts`) gates the social tile
(on → the new `SocialFlow`, off/unsettled → the legacy socialMedia
TaskFlow), and `voter-outreach-v2-sms`
(`@shared/experiments/voterOutreachV2SmsFlag.ts`) gates the SMS tile
(on → `v2/sms/SmsFlow.tsx`, off → the legacy TaskFlow). The text gate
(Pro/compliance) runs in front of BOTH SMS targets.

## v2/ — the Voter Outreach 2.0 hub (phases 1-2)

| File | Role |
|------|------|
| `v2/OutreachPageGate.tsx` | Whole-page flag gate (exposure fires here for both arms) |
| `v2/OutreachHubPage.tsx` | Flag-on page: tile grid + unified history + details drawer; passes the shared `navHeader` (send icon + Voter Outreach from `navLabels.ts`) so the v2 arm gets the standard tab title bar (the legacy arm stays untouched); consumes the `?outreachId=` deep link (opens the drawer) and mounts `OutreachComposeDeepLink` so `?compose=`/`?listId=` keep feeding the legacy flow launch |
| `v2/ChannelTileGrid.tsx` | Channel tiles (styleguide `ChannelCard`). Social opens the new flow behind `voter-outreach-v2-social` (off → legacy socialMedia TaskFlow); SMS/robocall/phone banking launch the EXISTING legacy `TaskFlow` with the same gates as the legacy cards (text gate, Pro modal, consume-once `preselectedListId`); door knocking navigates to `/dashboard/door-knocking`. Pricing sub-copy comes from `OUTREACH_OPTIONS` in `components/OutreachCreateCards.tsx` |
| `v2/OutreachHistoryTable.tsx` | Unified history (legacy + new rows): channel badge, per-channel metric (social = "N platforms" from the detail fetch), Results column (em-dash placeholder until the per-channel result sweeps land in phases 2-4), `StatusText` status, client-side channel/status filter popover, 10-row pagination. The prototype's Archive toggle is deliberately absent: no `archived` concept exists on the data model yet |
| `v2/historyStatus.util.ts` | The two legacy status vocabularies (p2p vs non-p2p), relocated from `components/OutreachTable.tsx`; the legacy table keeps its own copy until deletion at the final tile swap. Deliberate divergence: `completed` reads "Done" on the v2 surface (prototype vocabulary) vs legacy's "Sent" — a product call, not drift |
| `v2/OutreachDetailsDrawer.tsx` | Row-click drawer over `GET /v1/outreach/:id`: overview metrics, audience chips, and for social the persisted per-platform assets with re-copy |
| `v2/OutreachSheet.tsx` | Bottom-sheet anatomy (608px column in header/body/footer, viewport minus 64px / 128px on lg, per the design prototype) — a deliberate COPY of the CRM's `CrmSheet`, not an import (that sheet is Lovable-pixel-locked; outreach will drift) |
| `v2/OutreachFlowShell.tsx` | Generic flow chrome: sticky header (desktop Back floats left of the column, mobile icon-only slot) + bar `Stepper`, shell-owned step-keyed CTA, dirty-close "Discard changes?" confirm, scroll-to-top on step change |
| `v2/social/SocialFlow.tsx` | The social channel flow: purpose → compose → platforms → share. Compose drafts are AI-generated: picking a purpose (and each tone-pill click / Regenerate) fires stateless `POST /v1/outreach/social/draft` with purpose + tone, showing the thinking-stream card while it runs; the custom purpose never generates fresh (no call). The compose card's bottom toolbar adds "Improve with AI" (same endpoint with `currentDraft`, polish-in-place; shown only once the user has typed/dictated — the manuallyEdited state that also gates Undo snapshots; works for custom too) and a dictation mic (`shared/dictation/`, appends transcript as manual input). `POST /v1/outreach/social/generate` runs once on entering the share step; Save (`POST /v1/outreach/social`) persists atomically and seeds the history + detail cache from the response |
| `v2/SocialAssetCards.tsx` | Per-platform asset cards (copy/script + caption) shared by the share step and the details drawer; clipboard failure falls back to a select-all readonly textarea |
| `v2/sms/SmsFlow.tsx` | The SMS channel flow (phase 2, initial build): purpose → audience (saved-list picker + in-flow list builder reusing the CRM wizard's `VoterFileStep`/`NameStep`/`useListWizardCount`; creates via the wizard's own endpoint, never edits an existing list) → schedule (48h min, 9am-9pm, no Send now) → compose → review+pay. Reuses the legacy draft-first purchase sequence verbatim: audience advance creates the Peerly phone list (`createP2pPhoneList` + `LongPoll` status), review entry creates the outreach with `draft: true`, and payment runs through `CheckoutSessionProvider`/`CheckoutPayment` (custom-mode Checkout Session, `PurchaseType.TEXT`) with the free-texts zero-amount branch in `v2/sms/SmsReviewStep.tsx` |
| `v2/sms/SmsComposeStep.tsx` | Compose with system-owned regions: the tone-flavored identification intro and the "Reply STOP to opt out." footer frame the AI-drafted body (`POST /v1/outreach/sms/draft`; per-tone memory / Improve / dictation, same contract as social). The submitted script is the client-side concatenation of the three regions — the backend has no region concept and sends the script to Peerly verbatim. Image REQUIRED (500 KB, JPG/PNG/GIF): the backend rejects imageless text/p2p sends |
| `v2/sms/smsCompose.util.ts` | SMS purposes (the social slugs minus issue_update), `identificationIntro`, `composeScript`, image constraints |

Flow state is flat client state; no server drafts — closing a dirty flow asks
to discard, reopening starts fresh. Nothing persists until Save.

## Legacy key files (flag off; still launched from the v2 tiles)

| File | Role |
|------|------|
| `components/OutreachPage.tsx` | Legacy top-level layout for the feature |
| `hooks/OutreachContext.tsx` | Feature-level context — outreach rows (both surfaces read/write it) |
| `components/OutreachCreateCards.tsx` / `OutreachCreateCard.tsx` | Legacy channel picker; `OUTREACH_OPTIONS` is the pricing/type source both surfaces share |
| `components/OutreachComposeDeepLink.tsx` | Consumes `?compose=text&message=<sms>` — opens the text TaskFlow with the preset script through the same gate as the create card, then strips the params (consume-once via `router.replace`). Mounted by BOTH surfaces |
| `hooks/useTextOutreachGate.tsx` | Single source for the text-channel gate (non-Pro → `P2PUpgradeModal`, Pro non-compliant → `ComplianceModal`, else pass) — create card, deep link, and v2 tiles all call it |
| `components/OutreachActions.tsx` + `*ActionOption.tsx` | Per-channel actions (download audience, copy script) |
| `components/OutreachImpact.tsx` | Sent / delivered metrics |
| `hooks/` | Feature-local hooks (audience fetching, scheduling) |
| `util/` | Pure helpers — message templating, audience shaping |
| `constants.tsx` | Channel definitions, status labels |

## Patterns

- **Context-driven**: `OutreachContext` holds the outreach rows. Components read from context rather than threading props through the action menus.
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

- The `FreeTextsBanner` nag is part of free-tier gating — check `app/dashboard/shared/ProUpgradeModal.tsx` rules before changing it. It renders on the legacy page only.
- Status labels in `constants.tsx` are mirrored on gp-api — keep them in sync if either side changes.

## Related

- `helpers/createOutreach.ts`, `helpers/createP2pPhoneList.ts`.
- `gpApi/outreach.api.ts` + `gpApi/types/outreach.types.ts` — shared shapes; the social endpoints live in `gpApi/api-endpoints.ts` with contracts from `@goodparty_org/contracts`.
