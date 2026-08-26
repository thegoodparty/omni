import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactNote, RoutePayloadTargetNotes } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import DoorNotesCard from './DoorNotesCard'
import {
  DoorNoteList,
  seedDoorNotes,
  withCreatedNote,
  withDeletedNote,
  withUpdatedNote,
} from './doorNotes'

const note = (overrides: Partial<ContactNote> = {}): ContactNote => ({
  id: 'note-1',
  personId: 'person-1',
  body: 'Dog in the front yard, use the side gate',
  createdAt: '2026-07-01T15:00:00.000Z',
  updatedAt: '2026-07-01T15:00:00.000Z',
  actorName: null,
  ...overrides,
})

// The card is controlled the way PersonSheet controls it: the list lives above
// it, so a test that held the list inside the card would be asserting against a
// component the walk never renders.
const Harness = ({ served }: { served?: RoutePayloadTargetNotes }) => {
  const [notes, setNotes] = useState<DoorNoteList>(() => seedDoorNotes(served))
  return (
    <DoorNotesCard
      personId="person-1"
      notes={notes}
      onCreated={(created) =>
        setNotes((list) => withCreatedNote(list, created))
      }
      onUpdated={(updated) =>
        setNotes((list) => withUpdatedNote(list, updated))
      }
      onDeleted={(noteId) => setNotes((list) => withDeletedNote(list, noteId))}
    />
  )
}

const renderCard = (served?: RoutePayloadTargetNotes) =>
  render(<Harness served={served} />)

const card = () => screen.getByRole('heading', { name: 'Notes' }).parentElement!

describe('DoorNotesCard reads', () => {
  it('renders the notes the route payload arrived with', () => {
    renderCard({
      entries: [
        note(),
        note({ id: 'note-0', body: 'Works nights, try weekends' }),
      ],
      total: 2,
    })

    const notes = within(card())
    expect(
      notes.getByText('Dog in the front yard, use the side gate'),
    ).toBeInTheDocument()
    expect(notes.getByText('Works nights, try weekends')).toBeInTheDocument()
  })

  // Product asked for the date and time a note was created, and that is also
  // the key ADR 0011 orders the list by — showing `updatedAt` instead would
  // give a card whose visible dates run out of order the first time anybody
  // fixes a typo.
  it('stamps each note with when it was written', () => {
    renderCard({ entries: [note()], total: 1 })

    expect(
      within(card()).getByText(/Jul 1, 2026, \d{1,2}:\d{2} (AM|PM)/),
    ).toBeInTheDocument()
  })

  it('marks an edited note without restamping it', () => {
    renderCard({
      entries: [note({ updatedAt: '2026-08-20T15:00:00.000Z' })],
      total: 1,
    })

    const stamp = within(card()).getByText(/Jul 1, 2026/)
    expect(stamp).toHaveTextContent('edited')
    expect(stamp).not.toHaveTextContent('Aug 20')
  })

  // The whole reason ADR 0011 put `total` on the wire rather than letting a
  // renderer infer truncation from the row count: three-of-four and
  // three-of-forty are the difference between "you have the gist" and "go read
  // the file", and a resident with exactly three notes must not read as
  // permanently truncated.
  it('says how many notes it is not showing', () => {
    renderCard({
      entries: [note(), note({ id: 'note-2' }), note({ id: 'note-3' })],
      total: 9,
    })

    expect(
      within(card()).getByText(/Showing the 3 most recent of 9/),
    ).toBeInTheDocument()
  })

  it('stays quiet when the served rows are the whole record', () => {
    renderCard({
      entries: [note(), note({ id: 'note-2' }), note({ id: 'note-3' })],
      total: 3,
    })

    expect(within(card()).queryByText(/most recent of/)).toBeNull()
  })

  it('names an empty record as a fact about the resident', () => {
    renderCard({ entries: [], total: 0 })

    expect(
      within(card()).getByText('No notes about this resident yet.'),
    ).toBeInTheDocument()
  })

  // A route the service worker snapshotted before ADR 0011 shipped has no
  // `notes` key, and the phone holding it cannot refetch. Saying "no notes
  // about this resident" there would state something the payload does not
  // support — the resident may have a dozen.
  it('blames the payload, not the resident, when the block is absent', () => {
    renderCard(undefined)

    const notes = within(card())
    expect(
      notes.getByText(/This walk was saved before notes rode the route/),
    ).toBeInTheDocument()
    expect(notes.queryByText('No notes about this resident yet.')).toBeNull()
  })
})

// The constraint the whole card is shaped around: canvassing happens on bad
// signal, so the sheet opens out of the route payload and asks the network for
// nothing. A blank card mid-conversation looks exactly like a resident nobody
// has written about.
describe('DoorNotesCard opening', () => {
  it('fetches nothing when it opens', async () => {
    const requests: string[] = []
    const record = ({ request }: { request: Request }) => {
      requests.push(`${request.method} ${request.url}`)
    }
    mswServer.events.on('request:start', record)

    renderCard({ entries: [note()], total: 9 })
    // A query started in a mount effect intercepts within a macrotask, so the
    // assertion has to happen after one rather than in the same tick.
    await new Promise((resolve) => setTimeout(resolve, 0))
    mswServer.events.removeListener('request:start', record)

    expect(
      within(card()).getByText('Dog in the front yard, use the side gate'),
    ).toBeInTheDocument()
    expect(within(card()).getByText(/of 9/)).toBeInTheDocument()
    expect(requests).toEqual([])
  })
})

describe('DoorNotesCard writes', () => {
  it('saves a new note and shows it without asking for the route again', async () => {
    const user = userEvent.setup()
    const created = note({
      id: 'note-new',
      body: 'Wants a yard sign',
      createdAt: '2026-08-24T15:00:00.000Z',
      updatedAt: '2026-08-24T15:00:00.000Z',
    })
    const serve = vi.fn()
    api.mock('POST /v1/contacts/:personId/notes', () => ({
      status: 200,
      data: created,
    }))
    api.mock('GET /v1/contacts/:personId/notes', () => {
      serve()
      return { status: 200, data: { results: [] } }
    })

    renderCard({ entries: [note()], total: 1 })
    await user.click(screen.getByRole('button', { name: 'Add a note' }))
    await user.type(screen.getByLabelText('Add a note'), 'Wants a yard sign')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    const notes = within(card())
    await waitFor(() =>
      expect(notes.getByText('Wants a yard sign')).toBeInTheDocument(),
    )
    // The response to a create IS the row, so re-reading the list would only
    // ask the server to repeat itself — and the read it would ask for is a
    // whole route serve.
    expect(serve).not.toHaveBeenCalled()
    // Newest first, and counted: two of two rather than a stale one.
    expect(
      notes.getAllByText(/Wants a yard sign|Dog in the front yard/)[0],
    ).toHaveTextContent('Wants a yard sign')
    expect(notes.queryByText(/most recent of/)).toBeNull()
  })

  it('keeps the text on screen when the save fails', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/:personId/notes', {
      status: 500,
      data: { message: 'nope' },
    })

    renderCard({ entries: [], total: 0 })
    await user.click(screen.getByRole('button', { name: 'Add a note' }))
    await user.type(screen.getByLabelText('Add a note'), 'Wants a yard sign')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    // Writes are online-only by design, so this is the ordinary out-of-signal
    // path and not an edge case. The text a canvasser typed about a named voter
    // is the one thing that must survive it.
    await waitFor(() =>
      expect(screen.getByText(/your note is still here/)).toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Add a note')).toHaveValue('Wants a yard sign')
  })

  it('edits a note in place and closes the editor', async () => {
    const user = userEvent.setup()
    api.mock('PATCH /v1/contacts/notes/:noteId', ({ body }) => ({
      status: 200,
      data: note({ body: body.body, updatedAt: '2026-08-24T15:00:00.000Z' }),
    }))

    renderCard({ entries: [note()], total: 1 })
    await user.click(screen.getByRole('button', { name: /^Edit note from/ }))
    const editor = screen.getByLabelText('Edit note')
    await user.clear(editor)
    await user.type(editor, 'Side gate is locked now')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const notes = within(card())
    await waitFor(() =>
      expect(notes.getByText('Side gate is locked now')).toBeInTheDocument(),
    )
    expect(screen.queryByLabelText('Edit note')).toBeNull()
    // Editing is not new contact, so the count is untouched and the card still
    // reports the record as whole.
    expect(notes.queryByText(/most recent of/)).toBeNull()
  })

  // The requirement the count exists for: a resident at the cap who deletes one
  // must not be left reading a total that sends the canvasser looking for notes
  // that are no longer there.
  it('deletes a note and brings the count down with it', async () => {
    const user = userEvent.setup()
    api.mock('DELETE /v1/contacts/notes/:noteId', { status: 200, data: {} })

    renderCard({
      entries: [note(), note({ id: 'note-2', body: 'Works nights' })],
      total: 9,
    })
    expect(within(card()).getByText(/most recent of 9/)).toBeInTheDocument()

    await user.click(
      screen.getAllByRole('button', { name: /^Delete note from/ })[0]!,
    )
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const notes = within(card())
    await waitFor(() =>
      expect(
        notes.queryByText('Dog in the front yard, use the side gate'),
      ).toBeNull(),
    )
    expect(
      notes.getByText(/Showing the 1 most recent of 8/),
    ).toBeInTheDocument()
  })

  // Free text nobody can retype, on a phone held one-handed in the rain. Every
  // other write in this sheet is one tap to reverse; this one is not.
  it('leaves the note alone if the confirm is dismissed', async () => {
    const user = userEvent.setup()
    const deleted = vi.fn()
    api.mock('DELETE /v1/contacts/notes/:noteId', () => {
      deleted()
      return { status: 200, data: {} }
    })

    renderCard({ entries: [note()], total: 1 })
    await user.click(screen.getByRole('button', { name: /^Delete note from/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleted).not.toHaveBeenCalled()
    expect(
      within(card()).getByText('Dog in the front yard, use the side gate'),
    ).toBeInTheDocument()
  })

  it('reports a delete that did not go', async () => {
    const user = userEvent.setup()
    api.mock('DELETE /v1/contacts/notes/:noteId', {
      status: 500,
      data: { message: 'nope' },
    })

    renderCard({ entries: [note()], total: 1 })
    await user.click(screen.getByRole('button', { name: /^Delete note from/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(screen.getByText(/didn’t delete/)).toBeInTheDocument(),
    )
    expect(
      within(card()).getByText('Dog in the front yard, use the side gate'),
    ).toBeInTheDocument()
  })

  // Two textareas open at once fight over focus on a phone and offer two
  // competing Save buttons.
  it('never offers the composer and an editor at the same time', async () => {
    const user = userEvent.setup()

    renderCard({ entries: [note()], total: 1 })
    await user.click(screen.getByRole('button', { name: 'Add a note' }))
    expect(screen.getByLabelText('Add a note')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Edit note from/ }))

    expect(screen.queryByLabelText('Add a note')).toBeNull()
    expect(screen.getByLabelText('Edit note')).toBeInTheDocument()
    // And the affordance that would reopen it is withheld rather than left to
    // reintroduce the same collision one tap later.
    expect(screen.queryByRole('button', { name: 'Add a note' })).toBeNull()
  })
})
