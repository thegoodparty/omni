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
// 2026-07-16: 542 -> 543 for OnboardingCampaignStoryStep, the skippable
// campaign-story onboarding step holds local completion/skip state and wires
// user interaction into the pledge-flow "Continue" gating, so it can't be a
// server component.
// 2026-07-16: 543 -> 542 for deleting the standalone campaign-story route:
// removed page.tsx and its orphaned client component CampaignStoryPage.tsx now
// that onboarding and the plan-tab gate compose the cards directly.
// 2026-07-17: 542 -> 543 for PersonalizeStoryCard, the manager-home story card:
// it must be a client component because it reads useCampaignStoryComplete (a
// React Query hook) to decide whether to render.
const BASELINE = 543

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
