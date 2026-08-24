import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { ContactNote } from 'app/dashboard/contacts/crm/shared/contacts-types'
import PhoneBankingNotes from './PhoneBankingNotes'

const PERSON_ID = 'person-1'

const makeNote = (overrides: Partial<ContactNote> = {}): ContactNote => ({
  id: 'note_1',
  personId: PERSON_ID,
  body: 'Left a voicemail, will call back',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
})

describe('<PhoneBankingNotes>', () => {
  it('opens the compose form and saves a new note through the existing notes API', async () => {
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

    render(<PhoneBankingNotes personId={PERSON_ID} />)

    await user.click(await screen.findByRole('button', { name: 'Add a note' }))
    await user.type(screen.getByLabelText('Add a note'), 'Call back Tuesday')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    expect(await screen.findByText('Call back Tuesday')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add a note' }),
    ).toBeInTheDocument()
  })

  it('deletes a note after confirming', async () => {
    const user = userEvent.setup()
    let notes: ContactNote[] = [makeNote()]
    api.mock('GET /v1/contacts/:personId/notes', () => ({
      status: 200,
      data: { results: notes },
    }))
    api.mock('DELETE /v1/contacts/notes/:noteId', ({ params }) => {
      notes = notes.filter((note) => note.id !== params.noteId)
      return { status: 200, data: {} }
    })

    render(<PhoneBankingNotes personId={PERSON_ID} />)

    await screen.findByText('Left a voicemail, will call back')
    await user.click(screen.getByRole('button', { name: 'Delete note' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await screen.findByRole('button', { name: 'Add a note' })
    expect(
      screen.queryByText('Left a voicemail, will call back'),
    ).not.toBeInTheDocument()
  })
})
