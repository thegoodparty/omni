import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { CampaignTurfList } from './CampaignTurfList'

// Every mutation here snackbars, and `render` wraps only a QueryClient.
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

// The drawer's sibling list, which had no tests at all until it grew a write.
// What is pinned here is mostly about which rows offer which control: the row
// used to branch on `archived` alone, so a FINISHED turf still offered a
// Continue link into a walk with nothing left to knock.
describe('CampaignTurfList', () => {
  const successSnackbar = vi.fn()
  const errorSnackbar = vi.fn()

  beforeEach(() => {
    vi.mocked(useSnackbar).mockReturnValue({
      displaySnackbar: vi.fn(),
      errorSnackbar,
      successSnackbar,
    })
  })

  const turf = (fields: Record<string, unknown> = {}) => ({
    id: 12,
    outreachId: 30,
    voterFileFilterId: 4,
    name: 'Elm St & 5th',
    color: '#2563eb',
    geoPoly: { type: 'Polygon', coordinates: [] },
    stopCount: 3,
    doorCount: 4,
    knockedDoorCount: 3,
    peopleCount: 9,
    loggedCount: 6,
    routeSeconds: 900,
    completed: false,
    archivedAt: null,
    createdAt: new Date('2026-08-10T00:00:00Z'),
    updatedAt: new Date('2026-08-10T00:00:00Z'),
    ...fields,
  })

  const mockTurfs = (turfs = [turf()]) =>
    api.mock('GET /v1/door-knocking/campaigns/:anchorId', {
      status: 200,
      data: turfs as never,
    })

  const renderList = (props: { onConfirmOpenChange?: () => void } = {}) =>
    render(
      <CampaignTurfList anchorOutreachId={30} outreachId={30} {...props} />,
    )

  it('renders a row per turf with its counts', async () => {
    mockTurfs([turf({ id: 12 }), turf({ id: 13, name: 'Oak Ave' })])
    renderList()

    expect(await screen.findByText('Elm St & 5th')).toBeInTheDocument()
    expect(screen.getByText('Oak Ave')).toBeInTheDocument()
    // Stops and people, in that order: stops is the router's own unit and
    // the one the 150 cap is stated in. Doors sit between the two and are
    // deliberately not on the card.
    expect(screen.getAllByText('3 stops, 9 people')).toHaveLength(2)
  })

  it('offers Continue and Mark done on an active turf', async () => {
    mockTurfs()
    renderList()

    expect(
      await screen.findByRole('link', { name: 'Continue' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/door-knocking?walkTurfId=12&outreachId=30',
    )
    expect(
      screen.getByRole('button', { name: 'Mark done' }),
    ).toBeInTheDocument()
  })

  // The bug this fixes: what Done takes away IS Knock, so a finished turf
  // must not deep-link into its own walk.
  it('offers neither control on a finished turf, and says Done', async () => {
    mockTurfs([turf({ completed: true })])
    renderList()

    expect(await screen.findByText('Done')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull()
  })

  it('reads Archived on a shelved turf', async () => {
    mockTurfs([turf({ archivedAt: new Date('2026-08-20T00:00:00Z') })])
    renderList()

    expect(await screen.findByText('Archived')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull()
  })

  it('confirms before marking a partly logged turf done', async () => {
    mockTurfs([turf({ peopleCount: 9, loggedCount: 6 })])
    let completed = false
    api.mock('POST /v1/door-knocking/turfs/:id/complete', () => {
      completed = true
      return { status: 200, data: turf({ completed: true }) as never }
    })
    renderList()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark done' }),
    )

    expect(await screen.findByText('Mark this turf done?')).toBeInTheDocument()
    expect(
      screen.getByText(
        "3 people in Elm St & 5th aren't logged yet. This can't be undone.",
      ),
    ).toBeInTheDocument()
    expect(completed).toBe(false)
  })

  it('posts that row’s own turf id on confirm', async () => {
    // Three rows with distinct ids, so a mix-up cannot pass.
    mockTurfs([
      turf({ id: 12 }),
      turf({ id: 13, name: 'Oak Ave' }),
      turf({ id: 14, name: 'Pine St' }),
    ])
    let completedId: string | undefined
    api.mock('POST /v1/door-knocking/turfs/:id/complete', ({ params }) => {
      completedId = params.id
      return { status: 200, data: turf({ completed: true }) as never }
    })
    renderList()

    const oakRow = (await screen.findByText('Oak Ave')).closest('div')
      ?.parentElement as HTMLElement
    await userEvent.click(
      within(oakRow).getByRole('button', { name: 'Mark done' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Mark done' }),
    )

    expect(completedId).toBe('13')
  })

  // Leaving the walk would have stamped it anyway, so there is nothing to
  // warn about.
  it('marks a fully logged turf done with no dialog', async () => {
    mockTurfs([turf({ peopleCount: 9, loggedCount: 9 })])
    let completedId: string | undefined
    api.mock('POST /v1/door-knocking/turfs/:id/complete', ({ params }) => {
      completedId = params.id
      return { status: 200, data: turf({ completed: true }) as never }
    })
    renderList()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark done' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(completedId).toBe('12')
  })

  // The drawer's `onInteractOutside` guard depends on this, and it is
  // invisible from inside this component.
  it('reports when its confirm opens and closes', async () => {
    mockTurfs()
    const onConfirmOpenChange = vi.fn()
    renderList({ onConfirmOpenChange })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark done' }),
    )
    expect(onConfirmOpenChange).toHaveBeenCalledWith(true)

    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Keep knocking' }),
    )
    expect(onConfirmOpenChange).toHaveBeenCalledWith(false)
  })

  it('links Add another turf into the create flow for this campaign', async () => {
    mockTurfs()
    renderList()

    expect(
      await screen.findByRole('link', { name: 'Add another turf' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/door-knocking?campaignOutreachId=30&create=1',
    )
  })
})
