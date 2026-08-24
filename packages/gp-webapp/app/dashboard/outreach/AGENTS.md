# app/dashboard/outreach/

Voter outreach hub. Lets a campaign create text/voicemail/script/social outreach to voter audiences and tracks impact. Note: the directory is `outreach/` even though the tech design refers to it as "voter-outreach."

## Two surfaces, one flag

`page.tsx` (server component, fetches rows + compliance) renders
`v2/OutreachPageGate.tsx`, the single treatment/control divergence point on
the `voter-outreach-v2` flag (`@shared/experiments/voterOutreachV2Flag.ts`).
Flag on renders the v2 hub (`v2/`); flag off (or unsettled — respect `ready`)
renders the legacy `components/OutreachPage.tsx` unchanged. The two UIs never
mix; turning the flag off restores the legacy page exactly.

Inside the v2 hub, each channel's tile target is its own swap flag:
`voter-outreach-v2-social` (`@shared/experiments/voterOutreachV2SocialFlag.ts`)
gates the social tile — on opens the new `SocialFlow`, off (or unsettled)
launches the legacy socialMedia TaskFlow. So the hub can ship with 100%
legacy behavior underneath and channels flip individually; later phases add
their own swap flags the same way.

`voter-outreach-v2-phone-banking`
(`@shared/experiments/voterOutreachV2PhoneBankingFlag.ts`) is the phone-banking
tile's swap flag, with one difference from social/robocall: flag-on also
changes the Pro gate. A non-Pro click on the tile redirects straight to
`/dashboard/pro-upgrade` (firing `EVENTS.ProUpgrade.Compliance.LockedItemClicked`)
instead of the legacy Pro modal — upgrade-at-entry, the pattern later channels
adopt too. The predicate is `ChannelTileGrid`'s own `canUseProFeatures`
(`!!campaign?.isPro || !!electedOffice`, not imported from
`ContactsTableProvider` — that hook is contacts-scoped) and a pending
`useElectedOffice()` query is never read as a refusal. Flag off or unsettled
keeps the legacy `phoneBanking` TaskFlow and its Pro modal byte-identical.

## v2/ — the Voter Outreach 2.0 hub (phase 1)

| File | Role |
|------|------|
| `v2/OutreachPageGate.tsx` | Whole-page flag gate (exposure fires here for both arms) |
| `v2/OutreachHubPage.tsx` | Flag-on page: tile grid + unified history + details drawer; passes the shared `navHeader` (send icon + Voter Outreach from `navLabels.ts`) so the v2 arm gets the standard tab title bar (the legacy arm stays untouched); consumes the `?outreachId=` deep link (opens the drawer) and mounts `OutreachComposeDeepLink` so `?compose=`/`?listId=` keep feeding the legacy flow launch |
| `v2/ChannelTileGrid.tsx` | Channel tiles (styleguide `ChannelCard`). Social and robocall open their new flows behind their own swap flags (off → legacy TaskFlow); phone banking opens `PhoneBankingFlow` behind `voter-outreach-v2-phone-banking` — off (or unsettled) launches the legacy `phoneBanking` TaskFlow with its legacy Pro modal, on redirects a non-Pro click to `/dashboard/pro-upgrade` instead (see above); SMS launches the EXISTING legacy `TaskFlow` with the same gates as the legacy cards (text gate, Pro modal, consume-once `preselectedListId`); door knocking navigates to `/dashboard/door-knocking`. Pricing sub-copy comes from `OUTREACH_OPTIONS` in `components/OutreachCreateCards.tsx` |
| `v2/OutreachHistoryTable.tsx` | Unified history (legacy + new rows): channel badge, per-channel metric (social = "N platforms", nativePhoneBanking = "N people called", both from the detail fetch), Results column (em-dash placeholder until the per-channel result sweeps land in phases 2-4; nativePhoneBanking fills it early with "N supporters" since that count is already on the detail), `StatusText` status, client-side channel/status filter popover (phone-bank groups legacy `phoneBanking` and `nativePhoneBanking` together), 10-row pagination. The Archive toggle (`Button` beside Filters, `aria-pressed`) swaps between active and archived rows off `Outreach.archivedAt`; toggling resets the page and swaps the heading/subcopy to "Archived outreach" |
| `v2/historyStatus.util.ts` | The two legacy status vocabularies (p2p vs non-p2p), relocated from `components/OutreachTable.tsx`; the legacy table keeps its own copy until deletion at the final tile swap. Deliberate divergence: `completed` reads "Done" on the v2 surface (prototype vocabulary) vs legacy's "Sent" — a product call, not drift. `nativePhoneBanking` envelopes only ever carry `in_progress`/`completed`; `completed` hits the non-p2p map but `in_progress` renders "In progress" (callers are actively dialing — the non-p2p map's "Scheduled" is a legacy pre-send state) |
| `v2/OutreachDetailsDrawer.tsx` | Row-click drawer over `GET /v1/outreach/:id`: overview metrics, audience chips, and for social the persisted per-platform assets with re-copy. For `nativePhoneBanking`, branches on the row's status: in-progress renders Progress ("X of N reached" off `phoneBanking.peopleCalled`/`peopleTotal`) + a static Payment details block (phone banking is free) + a "Continue calling" footer link to `/dashboard/outreach/phone-banking/[listId]`; completed renders one combined Results table (call-outcome breakdown from `byOutcome`/`entriesCalled`, then a yes/unsure/no support breakdown from `supporters`/`unsure`/`nonSupporters` over `peopleCalled`) + a footer pairing a compact ghost destructive Delete (`DELETE /v1/phone-banking/lists/:id`, cascades to the envelope row) with a `flex-1` outline Move to archive / Restore from archive (`PATCH /v1/outreach/:id/archive`, toggles off `row.archivedAt`) |
| `v2/OutreachSheet.tsx` | Bottom-sheet anatomy (608px column in header/body/footer, viewport minus 64px / 128px on lg, per the design prototype) — a deliberate COPY of the CRM's `CrmSheet`, not an import (that sheet is Lovable-pixel-locked; outreach will drift) |
| `v2/OutreachFlowShell.tsx` | Generic flow chrome: sticky header with NO visible title — one icon-only circular Back (`IconButton`, `aria-label="Back"`) at every breakpoint, in an always-reserved `size-10` slot so the row doesn't collapse on steps without a Back, paired with the close on the same row inside the content column — plus a bar `Stepper`, shell-owned step-keyed CTA, dirty-close "Discard changes?" confirm, scroll-to-top on step change |
| `v2/social/SocialFlow.tsx` | The social channel flow: purpose → compose → platforms → share. Compose drafts are AI-generated: picking a purpose (and each tone-pill click / Regenerate) fires stateless `POST /v1/outreach/social/draft` with purpose + tone (the server grounds drafts in the campaign story, issue positions, and plan when they exist — see `packages/gp-api/src/outreach/AGENTS.md`), showing the thinking-stream card while it runs; the custom purpose never generates fresh (no call). The compose card's bottom toolbar adds "Improve with AI" (same endpoint with `currentDraft`, polish-in-place; shown only once the user has typed/dictated — the manuallyEdited state that also gates Undo snapshots; works for custom too) and a dictation mic (`shared/dictation/`, appends transcript as manual input). `POST /v1/outreach/social/generate` runs once on entering the share step; Save (`POST /v1/outreach/social`) persists atomically and seeds the history + detail cache from the response |
| `v2/SocialAssetCards.tsx` | Per-platform asset cards (copy/script + caption) shared by the share step and the details drawer; clipboard failure falls back to a select-all readonly textarea |
| `v2/robocall/RobocallFlow.tsx` | The robocall channel flow, behind `voter-outreach-v2-robocall` (`@shared/experiments/voterOutreachV2RobocallFlag.ts`): purpose → audience → schedule ("When") → compose ("What do you want to say?") → a placeholder for the unbuilt remainder (payment). Robocall dials landlines, so BOTH counts use the landline dimension — `reachability.robocall` for a saved list, and a `{ hasLandline: true }` overlay on the in-flow builder count. The overlay is count-only: the saved list itself stays general, so the same list is still usable by another channel (see `v2/audience/useOutreachAudience.ts`). The compose step drafts a read-only script for non-custom purposes via `POST /v1/outreach/robocall/draft` (purpose + tone; a tone-pill click or Regenerate re-requests, custom never drafts — the candidate types their own) and requires a saved recording before Continue enables — see `v2/robocall/RobocallComposeStep.tsx` + `useRobocallRecorder.ts` |
| `v2/robocall/RobocallComposeStep.tsx` / `useRobocallRecorder.ts` | Compose step + its MediaRecorder hook. The hook owns the `idle → recording → preview → saved` state, the 60s hard cap, and object-URL lifecycle; the step renders the tone pills, the AI draft (read-only `<p>` for non-custom, `Textarea` for custom), and the record/upload/preview/save bar. Unlike social/phone-banking compose there's no Improve/Undo/dictation — the deliverable is the audio, the script is just what the candidate reads. The robocall script carries NO compliance disclaimer ("Paid for by", callback number, opt-out) — that needs a caller-ID number not known until CallHub, so it's deferred to the pay/review slice (see `packages/gp-api/src/outreach/AGENTS.md`) |
| `v2/robocallPurposes.ts` / `v2/phoneBankingPurposes.ts` / `v2/socialPurposes.ts` | Purpose slug → card copy, one file per channel. The copy is per-channel and must be read off that channel's canvas list, never copied across: robocall and phone banking say "Introduce myself to voters" / "Write my own script" where social says "Introduce myself" / "Write my own message", and only social has the seventh "Share an issue update" card. All three take their slugs from contracts now that robocall has its draft endpoint on the wire (`ROBOCALL_PURPOSE_VALUES`); each file owns only its per-channel card labels |
| `v2/phone-banking/PhoneBankingFlow.tsx` | The phone-banking channel flow (design-canvas anatomy, ENG-86ak4apmp): purpose → who → script → sheets → download/ready. Purpose picks one of six slugs (contracts `PhoneBankingPurposeSchema`) and immediately fires `POST /v1/outreach/phone-banking/draft` (purpose + tone; `currentDraft` polishes in place for Improve with AI — shown whenever the script is non-empty, no manually-edited gate — mirroring the social draft endpoint, no per-tone memory/Undo). Who defaults to the `all` audience source (no filters, no gate); Sheets' Continue fires `POST /v1/phone-banking/lists` directly (name was already collected on the script step, auto-suggested from the purpose) — a 400 empty-audience response renders inline on that step. On success the flow advances to the ready screen (step 5 of 5, no Back) which renders the summary card + a single download link (bare `print/[listId]/pdf` route, ENG-10918 — one PDF or a ZIP depending on `sheetCount`) firing `Voter Outreach - Phone Banking Call Sheet Downloaded`, and a shell CTA "Go to call list" that navigates to `/dashboard/outreach/phone-banking/[id]`. Create fires `Voter Outreach - Phone Banking Call List Created` |
| `v2/phone-banking/WhoStep.tsx` | Three audience sources, lifted into `PhoneBankingFlow` state: `all` (default, recommended — an empty `filters: {}` + `filterName: 'All voters'`, its reachable count from a mount-time `POST /v1/contacts/count` with `{}`), `saved` (an existing `VoterFileFilter`, its own live `phoneBanking` reachability count off `GET /v1/contacts/list-detail`), and `custom` (an inline builder over the CRM's `filters.config.ts` restricted to the four dimensions `PhoneBankingFiltersSchema` exposes — voter likelihood, party, cell phone, landline — with a debounced `POST /v1/contacts/count`). The "All lists" popover offers "Create a new list" (enters the builder sub-state) plus the saved lists only — not a per-row count, to avoid the CRM lists index's N+1 list-detail cost (see `packages/gp-api/src/contacts/AGENTS.md`). Picking "Create a new list" walks a `picker → builder → naming` sub-state (never moves the shell's stepper); naming's Continue commits the custom audience and advances the flow straight to the script step. A failed/timed-out saved-list count (no server-side fenced-count retry — people-db's 25s statement timeout is the only bound) renders an error state with Try again, never an indefinite spinner; the builder's live count is disabled until at least one filter is active. Reports the saved-list count's pending/failed state up to `PhoneBankingFlow` via `onCountStatusChange` (gates the picker's Continue) and the builder's live count via `onBuilderCountStatusChange` (gates the builder sub-state's Continue) — the `all` source needs no gate, and a failed custom-audience count is instead caught at create time by the API's validation |

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
| `components/OutreachImpact.tsx` | Impact-level badge (low/medium/high, icon + label) |
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
- **`OutreachType` is hand-rolled in five places** (`gpApi/types/outreach.types.ts`, `hooks/OutreachContext.tsx`, `constants.tsx`'s `OutreachTypeKey`/`OUTREACH_TYPES`, `util/getEffectiveOutreachType.ts`'s `VALID_OUTREACH_TYPES`, and `components/OutreachCreateCard.tsx`) instead of importing the contracts `OutreachType` enum. Consolidating onto the contracts enum is a real cleanup, deliberately deferred rather than folded into a feature ticket — file it separately if you're touching this area again.
- **`nativeDoorKnocking` is in four of those five, and its absence from the fifth is deliberate.** `VALID_OUTREACH_TYPES` is named like a type registry but is really the allowlist of types a **task** may open a create-flow for, and the knock transaction is the only writer of a `nativeDoorKnocking` envelope — `createOutreachSchema` rejects the type from clients outright. Adding it there would let `TasksList` open a flow modal for a channel that has no create flow. Don't "fix" the inconsistency without renaming the constant to match what it actually gates.
- **A missing `CHANNEL_META` key degrades silently, and `getChannelLabel` is why.** It falls back to capitalizing the raw type, so an unmapped channel renders as a plausible-looking `NativeDoorKnocking` in a grey badge rather than throwing. `CHANNEL_META` is typed `Record<OutreachType, ChannelMeta>`, so widening the union is what forces the entry to exist — keep that typing.

## Related

- `packages/gp-api/src/outreach/AGENTS.md` — the backend module: the social endpoints and their campaign-materials grounding, draft-first purchase finalization, and the Peerly seams.
- `helpers/createOutreach.ts`, `helpers/createP2pPhoneList.ts`.
- `gpApi/outreach.api.ts` + `gpApi/types/outreach.types.ts` — shared shapes; the social endpoints live in `gpApi/api-endpoints.ts` with contracts from `@goodparty_org/contracts`.
