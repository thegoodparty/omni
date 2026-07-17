import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import { useOrganization } from '@shared/organization-picker'
import NotesSection from './NotesSection'
import type { ContactNote } from '../shared/contacts-types'

vi.mock('../../../shared/useCrmEnabled', () => ({
  useCrmEnabled: vi.fn(),
}))

vi.mock('../../../shared/useWinVoterContext', () => ({
  useWinVoterContext: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockedUseCrmEnabled = vi.mocked(useCrmEnabled)
const mockedUseWinVoterContext = vi.mocked(useWinVoterContext)
const mockedUseOrganization = vi.mocked(useOrganization)

const PERSON_ID = 'p_1'

const makeNote = (overrides: Partial<ContactNote> = {}): ContactNote => ({
  id: 'note_1',
  personId: PERSON_ID,
  body: 'Called about the lawn ordinance',
  createdAt: '2026-07-01T12:00:00.000Z',
  updatedAt: '2026-07-01T12:00:00.000Z',
  ...overrides,
})

describe('<NotesSection>', () => {
  beforeEach(() => {
    mockedUseCrmEnabled.mockReset()
    mockedUseWinVoterContext.mockReset()
    mockedUseOrganization.mockReset()
    vi.mocked(trackEvent).mockClear()

    mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
    mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUseOrganization.mockReturnValue({ slug: 'org-1' } as any)
  })

  it('does not render when the CRM flag is off', () => {
    mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: false })
    api.mock('GET /v1/contacts/:personId/notes', {
      status: 200,
      data: { results: [] },
    })

    const { container } = render(<NotesSection personId={PERSON_ID} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('does not render while the CRM gate is not ready', () => {
    mockedUseCrmEnabled.mockReturnValue({ ready: false, enabled: false })
    api.mock('GET /v1/contacts/:personId/notes', {
      status: 200,
      data: { results: [] },
    })

    const { container } = render(<NotesSection personId={PERSON_ID} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the empty state, then adding a note replaces it with the list', async () => {
    const user = userEvent.setup()
    let notes: ContactNote[] = []
    api.mock('GET /v1/contacts/:personId/notes', () => ({
      status: 200,
      data: { results: notes },
    }))
    api.mock('POST /v1/contacts/:personId/notes', ({ body }) => {
      const created = makeNote({ id: 'note_new', body: body.body })
      notes = [created, ...notes]
      return { status: 200, data: created }
    })

    render(<NotesSection personId={PERSON_ID} />)

    expect(await screen.findByText(/no notes yet/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Add a note'), 'Follow up next week')
    await user.click(screen.getByRole('button', { name: 'Add a note' }))

    expect(await screen.findByText('Follow up next week')).toBeInTheDocument()
    expect(screen.queryByText(/no notes yet/i)).not.toBeInTheDocument()
    // The input clears after a successful save.
    expect(screen.getByLabelText('Add a note')).toHaveValue('')
  })

  it('edits a note in place', async () => {
    const user = userEvent.setup()
    let notes: ContactNote[] = [makeNote()]
    api.mock('GET /v1/contacts/:personId/notes', () => ({
      status: 200,
      data: { results: notes },
    }))
    api.mock('PATCH /v1/contacts/notes/:noteId', ({ params, body }) => {
      notes = notes.map((n) =>
        n.id === params.noteId ? { ...n, body: body.body } : n,
      )
      return { status: 200, data: notes[0]! }
    })

    render(<NotesSection personId={PERSON_ID} />)

    await screen.findByText('Called about the lawn ordinance')
    await user.click(screen.getByRole('button', { name: 'Edit note' }))

    const editField = screen.getByLabelText('Edit note body')
    await user.clear(editField)
    await user.type(editField, 'Updated note body')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Updated note body')).toBeInTheDocument()
    expect(
      screen.queryByText('Called about the lawn ordinance'),
    ).not.toBeInTheDocument()
  })

  it('shows an error and keeps the edit form open when a save fails', async () => {
    const user = userEvent.setup()
    api.mock('GET /v1/contacts/:personId/notes', {
      status: 200,
      data: { results: [makeNote()] },
    })
    api.mock('PATCH /v1/contacts/notes/:noteId', {
      status: 500,
      data: { message: 'boom' },
    })

    render(<NotesSection personId={PERSON_ID} />)

    await screen.findByText('Called about the lawn ordinance')
    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(/couldn.t save your note/i),
    ).toBeInTheDocument()
    // The edit form stays open so the user can retry.
    expect(screen.getByLabelText('Edit note body')).toBeInTheDocument()
  })

  it('deletes a note only after confirming', async () => {
    const user = userEvent.setup()
    let notes: ContactNote[] = [makeNote()]
    const deleteHandler = vi.fn(() => {
      notes = []
      return { status: 200 as const, data: {} }
    })
    api.mock('GET /v1/contacts/:personId/notes', () => ({
      status: 200,
      data: { results: notes },
    }))
    api.mock('DELETE /v1/contacts/notes/:noteId', deleteHandler)

    render(<NotesSection personId={PERSON_ID} />)

    await screen.findByText('Called about the lawn ordinance')
    await user.click(screen.getByRole('button', { name: 'Delete note' }))

    const dialog = await screen.findByRole('alertdialog')
    // Opening the confirm dialog must not have deleted anything yet.
    expect(deleteHandler).not.toHaveBeenCalled()
    expect(
      screen.getByText('Called about the lawn ordinance'),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteHandler).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.queryByText('Called about the lawn ordinance'),
      ).not.toBeInTheDocument(),
    )
  })

  it('fires the Win-mode Note Added event once on a successful create', async () => {
    mockedUseWinVoterContext.mockReturnValue({ isWin: true, isReady: true })
    const user = userEvent.setup()
    let notes: ContactNote[] = []
    api.mock('GET /v1/contacts/:personId/notes', () => ({
      status: 200,
      data: { results: notes },
    }))
    api.mock('POST /v1/contacts/:personId/notes', ({ body }) => {
      const created = makeNote({ id: 'note_new', body: body.body })
      notes = [created, ...notes]
      return { status: 200, data: created }
    })

    render(<NotesSection personId={PERSON_ID} />)
    await screen.findByText(/no notes yet/i)

    await user.type(screen.getByLabelText('Add a note'), 'A new note')
    await user.click(screen.getByRole('button', { name: 'Add a note' }))

    await screen.findByText('A new note')
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.NoteAdded)
  })

  it('fires the Serve-mode Note Added event once on a successful create', async () => {
    mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: true })
    const user = userEvent.setup()
    let notes: ContactNote[] = []
    api.mock('GET /v1/contacts/:personId/notes', () => ({
      status: 200,
      data: { results: notes },
    }))
    api.mock('POST /v1/contacts/:personId/notes', ({ body }) => {
      const created = makeNote({ id: 'note_new', body: body.body })
      notes = [created, ...notes]
      return { status: 200, data: created }
    })

    render(<NotesSection personId={PERSON_ID} />)
    await screen.findByText(/no notes yet/i)

    await user.type(screen.getByLabelText('Add a note'), 'A new note')
    await user.click(screen.getByRole('button', { name: 'Add a note' }))

    await screen.findByText('A new note')
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.ConstituentData.NoteAdded)
  })

  it('never fires Note Added when create fails', async () => {
    const user = userEvent.setup()
    api.mock('GET /v1/contacts/:personId/notes', {
      status: 200,
      data: { results: [] },
    })
    api.mock('POST /v1/contacts/:personId/notes', {
      status: 500,
      data: { message: 'boom' },
    })

    render(<NotesSection personId={PERSON_ID} />)
    await screen.findByText(/no notes yet/i)

    await user.type(screen.getByLabelText('Add a note'), 'A new note')
    await user.click(screen.getByRole('button', { name: 'Add a note' }))

    await waitFor(() =>
      expect(screen.getByText(/couldn.t save your note/i)).toBeInTheDocument(),
    )
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
