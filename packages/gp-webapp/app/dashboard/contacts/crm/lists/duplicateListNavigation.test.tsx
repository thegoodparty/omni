import { useRef, useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import {
  ContactsTableProvider,
  useContactsTable,
} from '../ContactsTableProvider'
import ListDetailSheet from './ListDetailSheet'
import ListsIndex from './ListsIndex'
import type { SegmentResponse } from '../shared/contacts-types'

// ENG-10777 repro: every existing test around selectList
// (ContactsTableProvider, ListDetailSheet, CrmContactsPage) mocks either
// useContactsTable or usePathname as a STATIC return value, so none of them
// exercise the thing this ticket is about — after selectList's
// window.history.pushState call, does the app actually observe the new URL
// and switch the sheet to the new list? vitest.setup.ts's global
// `usePathname: vi.fn(() => '/')` mock is never reactive, so the real
// app-router pushState -> usePathname sync (app-router.js patches
// history.pushState to dispatch ACTION_RESTORE) is untested here by
// construction. This file mocks next/navigation with a pathname store that
// reacts to window.history.pushState the same way, so the real
// ContactsTableProvider + real ListDetailSheet run through the actual
// navigation contract selectList/useDuplicateList depend on.
let pathname = '/dashboard/contacts/lists/42'
let search = ''
const pathListeners = new Set<() => void>()

const notifyPathListeners = () =>
  pathListeners.forEach((listener) => listener())

const subscribe = (onStoreChange: () => void) => {
  pathListeners.add(onStoreChange)
  return () => pathListeners.delete(onStoreChange)
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => useSyncExternalStore(subscribe, () => pathname),
  useSearchParams: () => {
    const cache = useRef<{ search: string; params: URLSearchParams }>({
      search: '__unset__',
      params: new URLSearchParams(),
    })
    return useSyncExternalStore(subscribe, () => {
      if (cache.current.search !== search) {
        cache.current = { search, params: new URLSearchParams(search) }
      }
      return cache.current.params
    })
  },
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'org-one' }),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
}))

const listDetailFixture = {
  demographics: { people: 100, avgAge: 42, avgIncome: 50000 },
  reachability: {
    sms: 10,
    robocall: 10,
    phoneBanking: 10,
    doorKnocking: 10,
    polls: 10,
  },
  outreachHistory: [],
}

const originalSegment: SegmentResponse = {
  id: 42,
  name: 'Doorknocking campaign',
  firstUsedForOutreachAt: '2026-07-01T00:00:00.000Z',
}

// Real pushState, patched only to mirror the sync step Next.js's app-router
// performs (app-router.js patches history.pushState to dispatch
// ACTION_RESTORE so usePathname/useSearchParams reflect the pushed URL,
// outside any React batch). Without this, the mocked hooks above would never
// observe selectList's navigation — same as every pushState caller in this
// codebase relies on Next's own patch for.
const realPushState = window.history.pushState.bind(window.history)
const syncPathnameFromPushState = (url?: string | URL | null) => {
  if (url) {
    const parsed = new URL(String(url), 'http://localhost')
    pathname = parsed.pathname
    search = parsed.search
  }
  notifyPathListeners()
}

const Harness = () => {
  const { currentlySelectedListId, selectList } = useContactsTable()
  return (
    <ListDetailSheet
      listId={currentlySelectedListId}
      onClose={() => selectList(null)}
    />
  )
}

const renderHarness = () =>
  render(
    <CampaignContext.Provider value={[null]}>
      <ContactsTableProvider>
        <Harness />
      </ContactsTableProvider>
    </CampaignContext.Provider>,
  )

// The card-kebab entry point (AC: "Duplicating from the card kebab opens the
// copy's detail sheet promptly"): renders the index (which the sheet floats
// over, per ENG-10725) and the sheet side by side, both reading the same
// real provider — no mocked useContactsTable.
const IndexAndSheetHarness = () => {
  const { currentlySelectedListId, selectList } = useContactsTable()
  return (
    <>
      <ListsIndex />
      <ListDetailSheet
        listId={currentlySelectedListId}
        onClose={() => selectList(null)}
      />
    </>
  )
}

const renderIndexAndSheetHarness = () =>
  render(
    <CampaignContext.Provider value={[null]}>
      <ContactsTableProvider>
        <IndexAndSheetHarness />
      </ContactsTableProvider>
    </CampaignContext.Provider>,
  )

describe('ENG-10777 — duplicate-list navigation, real provider + real sheet', () => {
  beforeEach(() => {
    pathname = '/dashboard/contacts/lists/42'
    search = ''
    api.mock('GET /v1/elected-office/current', { status: 404, data: {} })
    api.mock('GET /v1/contacts', {
      status: 200,
      data: {
        people: [],
        pagination: {
          totalResults: 0,
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: listDetailFixture,
    })
    vi.spyOn(window.history, 'pushState').mockImplementation(
      (data, unused, url) => {
        realPushState(data, unused, url)
        syncPathnameFromPushState(url)
      },
    )
  })

  afterEach(() => {
    vi.mocked(window.history.pushState).mockRestore()
  })

  it('switches the open sheet to the copy after duplicating from inside it (case: duplicate from the open sheet)', async () => {
    let segments: SegmentResponse[] = [originalSegment]
    api.mock('GET /v1/voters/voter-file/filters', () => ({
      status: 200,
      data: segments,
    }))
    api.mock('POST /v1/voters/voter-file/filter', () => {
      const copy = { id: 999, name: 'Doorknocking campaign (copy)' }
      segments = [...segments, copy]
      return { status: 200, data: copy }
    })

    const user = userEvent.setup()
    renderHarness()

    expect(await screen.findByText('Doorknocking campaign')).toBeInTheDocument()

    await user.click(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    )
    // ENG-10943: duplicate now gates on a confirmation dialog before firing
    // the create call.
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Duplicate' }),
    )

    // AC: "Duplicating from inside a list's detail sheet switches that sheet
    // to the copy" — the DrawerTitle must visibly become the copy's name.
    expect(
      await screen.findByText('Doorknocking campaign (copy)'),
    ).toBeInTheDocument()
  })

  it('opens the copy’s detail sheet from the card kebab menu (case: duplicate from the lists index)', async () => {
    pathname = '/dashboard/contacts'
    search = ''
    api.mock('GET /v1/contacts/stats', {
      status: 200,
      data: {
        districtId: 'district-1',
        computedAt: '2026-07-23T00:00:00.000Z',
        totalConstituents: 1000,
        totalConstituentsWithCellPhone: 800,
        buckets: {
          age: [],
          homeowner: [],
          education: [],
          presenceOfChildren: [],
          estimatedIncomeRange: [],
        },
      },
    })
    let segments: SegmentResponse[] = [originalSegment]
    api.mock('GET /v1/voters/voter-file/filters', () => ({
      status: 200,
      data: segments,
    }))
    api.mock('POST /v1/voters/voter-file/filter', () => {
      const copy = { id: 999, name: 'Doorknocking campaign (copy)' }
      segments = [...segments, copy]
      return { status: 200, data: copy }
    })

    const user = userEvent.setup()
    renderIndexAndSheetHarness()

    await user.click(
      await screen.findByRole('button', { name: 'List options' }),
    )
    await user.click(await screen.findByText('Duplicate to edit'))
    // ENG-10943: the kebab item now opens a confirmation dialog rather than
    // firing the create call directly.
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Duplicate' }),
    )

    // AC: "Duplicating from the card kebab opens the copy's detail sheet
    // promptly" — scoped to the dialog (not the index row behind it, which
    // also re-renders a "(copy)" card once the background invalidation
    // lands) — the sheet itself must show the copy.
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('Doorknocking campaign (copy)'),
    ).toBeInTheDocument()
  })

  it('does not flash "list not found" while the background index refetch is still slow', async () => {
    let segments: SegmentResponse[] = [originalSegment]
    // Gate only the invalidation-triggered refetch (the one fired after the
    // POST resolves) — the initial mount fetch must resolve normally so the
    // sheet is showing the original list before duplicating.
    let refetchGate: Promise<void> | null = null
    let resolveRefetchGate: (() => void) | undefined
    api.mock('GET /v1/voters/voter-file/filters', async () => {
      if (refetchGate) await refetchGate
      return { status: 200, data: segments }
    })
    api.mock('POST /v1/voters/voter-file/filter', () => {
      const copy = { id: 999, name: 'Doorknocking campaign (copy)' }
      segments = [...segments, copy]
      refetchGate = new Promise((resolve) => {
        resolveRefetchGate = resolve
      })
      return { status: 200, data: copy }
    })

    const user = userEvent.setup()
    renderHarness()

    await screen.findByText('Doorknocking campaign')
    await user.click(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    )
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(alertDialog).getByRole('button', { name: 'Duplicate' }),
    )

    // Selecting/navigating to the copy must not depend on that slow refetch
    // (ENG-10777's fix), but the sheet must also not read the pre-refetch,
    // still-stale cache as "this segment doesn't exist" in the meantime —
    // that would trade the old bug (nothing happens) for a false "deleted"
    // message on exactly the same slow connection.
    expect(
      await screen.findByText('Doorknocking campaign (copy)'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/couldn.t be found/i)).not.toBeInTheDocument()

    resolveRefetchGate?.()
  })
})
