#!/usr/bin/env node
// 'use client' ratchet.
//
// Counts the source files under this package whose first non-empty line is a
// `'use client'` directive and fails (exit 1) if that count exceeds the
// committed baseline below. The goal is to stop the number of client
// components from silently creeping up: every `'use client'` ships its module
// (and its imports) to the browser, so each one is a bundle-size and
// hydration cost.
//
// RATCHET POLICY:
//   - When you REMOVE a client component (delete the file or drop its
//     `'use client'` so it renders on the server), lower BASELINE to the new
//     count this script prints. That locks in the win.
//   - Do NOT raise BASELINE to make a red build green. A new client component
//     is a deliberate trade-off; if it's truly justified, raise the baseline
//     in the SAME PR with a one-line note in the PR description explaining why
//     the work could not be a server component.
//
// Run: `npm run check:use-client -w packages/gp-webapp`

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Lower this when you remove client components; never raise it without a
// justified reason (see RATCHET POLICY above).
// 2026-07-07: re-synced 504 -> 524, the count the script itself measures on
// develop. The original baseline was below develop's actual count when the
// ratchet merged, so every PR failed regardless of its changes. No new client
// components were added by this change; the ratchet holds the line from the
// real number.
// 2026-07-08: 524 -> 527 for the profile/account consolidation. The new
// profile/account cards and dialogs (office details, your details, personal &
// account info, term-date editor, etc.) are interactive — they use React state,
// event handlers, and hooks — so they can't be server components. Net +3 after
// deleting the retired inline-edit sections.
// 2026-07-08: 527 -> 528 for useOutreachComposeFlow — the in-place outreach
// launcher (tracker/manager task cards) must be a client component: it holds
// the open-flow modal state and mounts the interactive TaskFlow wizard.
// 2026-07-09: 528 -> 533 for the Serve Ordinances flow UI (slice 3): the
// per-step chat surface, the interactive clarify-question widget, the intake
// form, the stepper, and the shared agent-chat presentation are all stateful
// (hooks, event handlers, streaming) and can't be server components.
// 2026-07-10: 533 -> 534 for useCampaignStoryComplete — a React Query hook
// (useQuery + useCampaignStory) that gates the campaign-plan router on story
// completeness, so it must run on the client.
// 2026-07-13: 534 -> 536 for the Ordinances list page's two sections
// (MyOrdinancesSection, MyPriorityIssuesSection): both are interactive —
// client-side status filtering, and the "Work on this" seed action with
// useRouter — so they can't be server components. The page.tsx shell stays a
// server component.
// 2026-07-10: 536 -> 538 for BriefingDispatchBanner and
// CommunityIssuesDispatchBanner — both poll gp-api client-side after mount
// (useState + useEffect + a react-query refetchInterval) to show a
// "generating..." banner once the user lands back in the product; that
// polling loop cannot run on the server.
// 2026-07-15: the draft-detail screen supersedes develop's OrdinanceDraftDocument
// (removed) with DraftDetail (contentEditable inline editor with autosave +
// selection toolbar) and DraftChat (streaming chat in a drawer). Both are
// stateful client components; the page.tsx shell stays server.
// 2026-07-16: 540 -> 541 for useCrmEnabled — a hook composing
// useWinVoterContext (React Query) with two feature-flag reads, so it must
// run on the client, like the sibling useWinVoterContext.
// 2026-07-16: 541 -> 542 for ContactTypeahead — the CRM contacts search
// dropdown holds input/debounce state and a React Query fetch, so it cannot
// be a server component (same as the ContactSearch it flag-replaces).
// 2026-07-16: 542 -> 543 for app/dashboard/error.tsx — error boundaries must
// be client components (the Next.js error-file contract requires it), so the
// new dashboard-segment boundary adds exactly one.
// 2026-07-16: 543 -> 540 for removing the legacy impersonation path:
// ImpersonateUserProvider, useImpersonateUser, and the orphaned
// ImpersonateAction (gp-admin owns admin impersonation now).
// 2026-07-16: 540 -> 542 for the whole-page CRM gate (ENG-10683):
// ContactsPageGate branches on the client-resolved CRM flag, and
// CrmContactsPage hosts the interactive typeahead + Pro-modal state, so
// neither can be a server component. The crm/ moves themselves are
// count-neutral.
// ENG-10697: NotesSection.tsx is a new client component (useState +
// react-query mutations for the person-record notes CRUD) — genuinely
// interactive, can't render on the server.
// ENG-10698: LogInteraction.tsx is genuinely stateful (form state, a
// mutation, per-field validation) and can't be a server component.
// 2026-07-16: +1 for QualityReport — the ordinance draft quality-report section
// generates/re-runs and manages loading/error state, so it must be a client
// component.
// ENG-10711: -1 — LogInteraction.tsx removed (manual logging cut to match the
// lovable person-record design).
// 2026-07-17: 545 -> 550 for the ENG-10708 list creation wizard
// (crm/wizard/): CreateListWizard (dialog/step state + create mutation),
// BranchStep (controlled RadioGroup), VoterFileStep (checkbox filter state),
// ActivityStep (stacked condition rows + a react-query outreach fetch), and
// NameStep (name input) are all genuinely interactive and can't render on
// the server.
// 2026-07-17: 550 -> 555 for the ENG-10707 lists index + list-detail surface
// (crm/lists/): ListsTable (per-row react-query fetch + row-click
// navigation), ListDetailPage (multiple react-query reads, a rename/
// duplicate/delete flow, and the download poll), ListDetailPageGate
// (client-side CRM-flag redirect), RenameListDialog, and DeleteListDialog
// (dialog state + mutations) are all genuinely interactive and can't render
// on the server.
// 2026-07-17: 555 -> 557 for the ENG-10721 locked-prototype presentation
// refactor (no behavior change). ListsTable.tsx (a client component) was
// deleted and replaced by two new ones: ListsIndex.tsx (reads the
// useContactsTable() context hook) and ListCard.tsx (per-card useState for
// the rename/delete dialogs + a react-query row fetch) — net +1. Plus a new
// DistrictStatCard.tsx (a react-query read of the stats endpoint) — net +1.
// All three are genuinely interactive/data-fetching and can't render on the
// server; CrmContactsPage.tsx and the wizard step files were edited in place
// (no new client files there).
// ENG-10711: -1 — LogInteraction.tsx removed (manual logging cut to match the
// lovable person-record design).
// 2026-07-18: 556 -> 560 for the ENG-10737 contacts assistant bar: the four
// new crm/assistant/ files (CrmAssistant, AssistantBar, AssistantDrawer,
// assistantChat) hold composer/drawer state, stream SSE turns through the
// shared agent-chat client, and invalidate react-query caches — none can be
// server components.
// 2026-07-27: 557 -> 558 for StoryReadyCard — the campaign-manager completion
// card (localStorage-dismissed, reads useCampaignStoryComplete, routes on CTA),
// so it must run on the client.
// 2026-07-27: 558 -> 559 for CampaignManagerChatProvider — the always-present
// campaign-manager chat dock lifted out of CampaignManagerHome so it mounts once
// in DashboardLayout (footer chat on every page). It owns the drawer/kickoff
// state, streams SSE, and reads localStorage/useUser, so it can't be a server
// component. Net +1: it renders the footer + surface the home used to render
// inline (no new files there), and CampaignManagerHome stays a client component.
// 2026-07-27: 559 -> 546 for removing the legacy AI Assistant (campaign-assistant)
// dashboard feature — its route + ~15 client components (Chat, ChatProvider,
// ChatInput, history, feedback, etc.) were deleted. Campaign Manager supersedes
// it; the gp-api endpoints are left orphaned (removed from the frontend only).
// 2026-07-27: 546 -> 549 for the Serve/Win public-profile editor
// (app/dashboard/public-profile/): PublicProfileEditor (form + publish toggle +
// image-upload + save mutation), ListEditors (add/remove/controlled Recent
// Experience & Accomplishments rows), and PrioritiesPublicationEditor
// (per-priority visibility/status toggles + mutation) are all genuinely
// interactive and can't be server components. The page.tsx shell stays a server
// component (it fetches data and gates access). Net +3 over develop's 546.
// 2026-07-28: 549 -> 552 for the three native door-knocking client files
// (page gate, map page, map canvas — the canvas is behind next/dynamic
// ssr:false so the heavy libs stay out of shared bundles).
// 2026-07-28: 552 -> 554 for the door-knocking turf save flow:
// SaveTurfDialog (dialog form state + create mutation) and TurfList
// (react-query turfs read + delete mutation) are both interactive and live
// inside the client-only map page.
// 2026-07-28: 554 -> 557 for the door-knocking walk flow: KnockTurfDialog
// (mode/loop form + knock mutation), WalkView (route query + per-stop
// expand/record state), RecordKnockForm (answer state + interaction
// mutation) — all interactive, all inside the client-only map page.
// ENG-10836: +1 for crm/person/StatusRow.tsx — the person-record status row
// needs client hooks (useMutation/useQueryClient for the PATCH + optimistic
// update, useCrmEnabled for self-gating, Radix Select interactivity), so it
// can't render as a server component.
// ENG-10858: +1 for campaignManager/TextingSetupBanner.tsx — self-gates on
// useCampaign and fires a view event in an effect, like its sibling
// ProUpgradeBanner.
// +1 for ordinances/components/OrdinanceBugReportSheet.tsx — the draft's
// "Flag a bug" sheet manages description/submit state and opens a Vaul drawer,
// so it must be a client component.
// +1 for ordinances/components/redline/RedlineEditor.tsx — the amendment
// tracked-changes editor is a TipTap/ProseMirror instance, which is inherently
// client-only, so it can't render on the server.
// 2026-07-28: 561 -> 563 for the demo-parity pass: PersonSheet (household
// switcher + record flow state), TurfDetailsSheet (route/list queries), and
// createFlow/CreateListFlow (filter/draw/confirm step state) replace inline
// expansions; all are interactive surfaces inside the client-only map page.
// Net +2 after deleting SaveTurfDialog.
// 2026-08-13: 563 -> 564 for native/EditTurfDialog.tsx — the rename/recolor
// dialog holds draft name and color state and runs the PUT mutation, and it is
// opened from TurfDetailsSheet, itself a client component inside the client-only
// map page. Nothing here can render on the server.
// 2026-08-13: 564 -> 565 for door-knocking/native/DoorScript.tsx. The door
// script collapses on tap so it doesn't push the answer pills off a phone
// screen, and it renders inside PersonSheet, which is already client-only.
// 2026-08-13: 565 -> 566 for door-knocking/native/DoNotKnockControl.tsx — a
// mutating button pair (flag / undo) rendered inside the client-only
// PersonSheet, peer to RecordKnockForm.tsx, so it can't render on the server.
// 2026-08-17: 566 -> 567 for door-knocking/native/NotAVoterControl.tsx — the
// ADR 0008 follow-up and its marker, same shape and same reason as
// DoNotKnockControl above: it POSTs on tap and renders from the response,
// inside the client-only PersonSheet. The paper surfaces read the same reason
// through statusPresentation.ts, which stays directive-free so print/ keeps its
// zero.
// 2026-08-11: 567 -> 580 for Voter Outreach 2.0 phase 1: the flag-gated hub
// (gate, hub page, tile grid, history table, details drawer), the sheet/flow
// shell, the four social-flow steps + flow + thinking stream, and the shared
// asset cards / detail-fetch hook are all interactive drawer/wizard surfaces
// (flag reads, mutations, flow state) that can't be server components. Net
// +13 after deleting P2pUxEnabledProvider + useTcrComplianceCheck.
// 2026-08-20: 580 -> 581 for useCvPinGate — the shared CampaignVerify PIN gate.
// It owns a react-query subscription and returns a state the three PIN surfaces
// branch on, so it has to run in the browser; it replaces per-surface inline
// logic rather than adding a new client boundary.
// 2026-08-20: 581 -> 582 for door-knocking/native/DeleteTurfControl.tsx — the
// shared delete affordance owns the DELETE mutation, the confirm dialog's open
// state and the 409 path, so it cannot render on the server. It is the only one
// of its change's three new modules that needs the directive: TurfRoster.tsx
// binds no handler and holds no state, and audienceMix.ts is pure functions, so
// both stay directive-free and inherit the boundary from TurfDetailsSheet —
// same reason statusPresentation.ts does. (Written as 567 -> 568 before this
// branch was rebased onto Voter Outreach 2.0 and the PIN gate; the +1 is what
// this change is responsible for, and the entries above are the rest.)
// 2026-08-20: 582 -> 584 for Voter Outreach 2.0 phase 3 (robocall) slice 0/1:
// RobocallFlow (flow state) and RobocallPurposeStep (onClick selection) are
// interactive drawer surfaces mirroring the social flow, so both are client
// components.
// 2026-08-20: 584 -> 585 for the robocall audience step (phase 3, slice 2):
// OutreachAudienceStep — the shared, reusable saved-list picker + in-flow
// builder — owns the popover open state and click handlers, so it's a client
// component. Its data hook useOutreachAudience.ts stays directive-free (no JSX,
// pulled into the client graph by its importers).
// 2026-08-20: 584 -> 590 for the phone-banking create flow (ENG-10919):
// PhoneBankingFlow (flow state) and its five step components (PurposeStep,
// WhoStep, ScriptStep, SheetCountStep, DownloadStep) are all interactive
// drawer-step surfaces mirroring SocialFlow's shape, so all six are client
// components.
// 2026-08-21: 590 -> 594 for ENG-10921, the phone banking in-app caller page.
// PhoneBankingCallerPage (progress/entries + delete + query wiring),
// PhoneBankingEntryPanel (sheet/drawer switcher), PhoneBankingOutcomeForm
// (the outcome cascade + save mutation), and PhoneBankingNotes (notes CRUD)
// all hold client state, mutations, or event handlers, so all four must be
// client components; the route's page.tsx stays a server component.
// 2026-08-21: merge reconciliation — main's 594 (phone banking) plus this
// branch's OutreachAudienceStep (+1) = 595.
// 2026-08-21: 595 -> 599 for the four door-knocking surface seams
// (DoorKnockingManageView, CreateListSurface, TurfDetailsDrawer, WalkSurface).
// This is the one entry here that costs the browser nothing: it is a pure
// decomposition of NativeDoorKnockingPage, already a client component behind
// next/dynamic, into four files it is the sole importer of — the same modules
// in the same graph, split so four agents can rebuild four surfaces without
// editing one orchestrator. Each holds state, a query or handlers (rail sheet
// state, the address-preview query, polygonStats over a react-query read, the
// walk's open-stop request), so none could render on the server even in
// isolation. Directive-free was the alternative, since a module imported only
// from a client module inherits the boundary — rejected because these are the
// files four agents are about to build interactive surfaces in, and a
// directive-free stateful component reads as an oversight to copy. The
// genuinely inert new module, savedListFilters.ts, does stay directive-free,
// same rule as statusPresentation.ts.
// 2026-08-21: 599 -> 600 for the robocall schedule step (phase 3): the
// RobocallScheduleStep drawer surface owns the name/date/time inputs and their
// selection handlers, so it's a client component. Its scheduleTimeZone.ts
// helper is directive-free (pure date/tz functions, no JSX).
// 2026-08-24: 600 -> 601 for app/dashboard/shared/ListCard.tsx — the saved-list
// card the door-knocking rail is rebuilt on, and which voter data and campaign
// manager reuse. It binds a click handler on its title, so a server-component
// caller would fail at render; the directive is what makes it safe to import
// from a surface that hasn't got a boundary yet. Its two door-knocking siblings
// stay directive-free and inherit the boundary from their importers, the
// savedListFilters.ts rule: turfLifecycle.ts is a hooks module with no JSX, and
// TurfLegend.tsx holds no state and binds only handlers it is handed.
// 2026-08-24: 601 -> 603 for the robocall compose step (phase 3):
// RobocallComposeStep owns the tone pills, AI-draft display, and record-bar
// interaction, and its useRobocallRecorder hook drives MediaRecorder state and
// object-URL lifecycle — both hold browser-only state, so both are client.
const BASELINE = 603

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git')) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(fullPath)
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield fullPath
    }
  }
}

// Count a file when its first non-empty line is the `'use client'` directive.
function startsWithUseClient(contents) {
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    return /^['"]use client['"];?$/.test(line)
  }
  return false
}

const clientFiles = []
for await (const file of walk(PACKAGE_ROOT)) {
  const contents = await readFile(file, 'utf8')
  if (startsWithUseClient(contents)) {
    clientFiles.push(relative(PACKAGE_ROOT, file))
  }
}

const count = clientFiles.length
console.log(`'use client' files: ${count} (baseline ${BASELINE})`)

if (count > BASELINE) {
  console.error(
    `\nERROR: 'use client' count ${count} exceeds baseline ${BASELINE}.`,
  )
  console.error(
    'Prefer keeping new components as server components. If a new client ' +
      'component is truly necessary, raise BASELINE in ' +
      'scripts/check-use-client-count.mjs in this PR and note why.',
  )
  process.exit(1)
}

if (count < BASELINE) {
  console.log(
    `Nice — ${BASELINE - count} below baseline. Consider lowering BASELINE to ` +
      `${count} in scripts/check-use-client-count.mjs to lock in the win.`,
  )
}
