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
| `v2/OutreachHistoryTable.tsx` | Unified history (legacy + new rows): channel badge, per-channel metric (social = "N platforms" from the detail fetch), Results column (em-dash placeholder until the per-channel result sweeps land in phases 2-4), `StatusText` status, client-side channel/status filter popover, 10-row pagination. The prototype's Archive toggle is deliberately absent: no `archived` concept exists on the data model yet |
| `v2/historyStatus.util.ts` | The two legacy status vocabularies (p2p vs non-p2p), relocated from `components/OutreachTable.tsx`; the legacy table keeps its own copy until deletion at the final tile swap. Deliberate divergence: `completed` reads "Done" on the v2 surface (prototype vocabulary) vs legacy's "Sent" — a product call, not drift |
| `v2/OutreachDetailsDrawer.tsx` | Row-click drawer over `GET /v1/outreach/:id`: overview metrics, audience chips, and for social the persisted per-platform assets with re-copy |
| `v2/OutreachSheet.tsx` | Bottom-sheet anatomy (608px column in header/body/footer, viewport minus 64px / 128px on lg, per the design prototype) — a deliberate COPY of the CRM's `CrmSheet`, not an import (that sheet is Lovable-pixel-locked; outreach will drift) |
| `v2/OutreachFlowShell.tsx` | Generic flow chrome: sticky header (desktop Back floats left of the column, mobile icon-only slot) + bar `Stepper`, shell-owned step-keyed CTA, dirty-close "Discard changes?" confirm, scroll-to-top on step change |
| `v2/social/SocialFlow.tsx` | The social channel flow: purpose → compose → platforms → share. Compose drafts are AI-generated: picking a purpose (and each tone-pill click / Regenerate) fires stateless `POST /v1/outreach/social/draft` with purpose + tone (the server grounds drafts in the campaign story, issue positions, and plan when they exist — see `packages/gp-api/src/outreach/AGENTS.md`), showing the thinking-stream card while it runs; the custom purpose never generates fresh (no call). The compose card's bottom toolbar adds "Improve with AI" (same endpoint with `currentDraft`, polish-in-place; shown only once the user has typed/dictated — the manuallyEdited state that also gates Undo snapshots; works for custom too) and a dictation mic (`shared/dictation/`, appends transcript as manual input). `POST /v1/outreach/social/generate` runs once on entering the share step; Save (`POST /v1/outreach/social`) persists atomically and seeds the history + detail cache from the response |
| `v2/SocialAssetCards.tsx` | Per-platform asset cards (copy/script + caption) shared by the share step and the details drawer; clipboard failure falls back to a select-all readonly textarea |
| `v2/phone-banking/PhoneBankingFlow.tsx` | The phone-banking channel flow: purpose → who → script → sheets → download. Purpose picks one of six slugs (contracts `PhoneBankingPurposeSchema`) and immediately fires `POST /outreach/phone-banking/draft` (purpose + tone; `currentDraft` polishes in place for Improve with AI, mirroring the social draft endpoint — no per-tone memory/Undo, a deliberate scope cut from `SocialFlow`). Who offers a saved `VoterFileFilter` (via `GET /v1/voters/voter-file/filters`, its own live `phoneBanking` reachability count off `GET /v1/contacts/list-detail`) or an inline pill audience over the CRM's `filters.config.ts` restricted to the four dimensions `PhoneBankingFiltersSchema` exposes (voter likelihood, party, cell phone, landline) with a required `filterName` and a debounced `POST /v1/contacts/count` — exactly one of `voterFileFilterId` or `filters`+`filterName` reaches the create call. Sheets picks 1-20 (60 numbers per sheet). Download names the campaign (auto-suggested from the purpose) and fires `POST /v1/phone-banking/lists`, which freezes the script + sheet count + resolved audience; a 400 empty-audience response renders inline. On success it fires `Voter Outreach - Phone Banking Call List Created` and shows the download-sheets link at the PDF route |
| `v2/phone-banking/WhoStep.tsx` | The saved-list-vs-inline-audience picker described above; a failed/timed-out count (no server-side fenced-count retry — people-db's 25s statement timeout is the only bound) renders an error state with Try again, never an indefinite spinner |

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

## Related

- `packages/gp-api/src/outreach/AGENTS.md` — the backend module: the social endpoints and their campaign-materials grounding, draft-first purchase finalization, and the Peerly seams.
- `helpers/createOutreach.ts`, `helpers/createP2pPhoneList.ts`.
- `gpApi/outreach.api.ts` + `gpApi/types/outreach.types.ts` — shared shapes; the social endpoints live in `gpApi/api-endpoints.ts` with contracts from `@goodparty_org/contracts`.
