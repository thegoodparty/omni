import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PersonProfileRemoval } from '@goodparty_org/sdk'
import { PersonRemovalList } from './PersonRemovalList'

vi.mock('./RestoreProfileButton', () => ({
  RestoreProfileButton: () => <button type="button">Undo</button>,
}))

const PERSON_ID = '22222222-2222-2222-2222-222222222222'

const removal = (
  overrides: Partial<PersonProfileRemoval> = {}
): PersonProfileRemoval => ({
  personId: PERSON_ID,
  note: 'CA privacy request',
  requestedAt: '2026-08-01T00:00:00.000Z',
  appliedBy: 'ops@goodparty.org',
  clearedAt: null,
  clearedBy: null,
  ...overrides,
})

describe('PersonRemovalList', () => {
  it('tells the operator when nothing is removed', () => {
    render(<PersonRemovalList removals={[]} />)

    expect(
      screen.getByText('No profiles are currently removed.')
    ).toBeInTheDocument()
  })

  it('shows who removed the profile and why', () => {
    render(<PersonRemovalList removals={[removal()]} />)

    expect(screen.getByText('ops@goodparty.org')).toBeInTheDocument()
    expect(screen.getByText('CA privacy request')).toBeInTheDocument()
    expect(screen.getByText(PERSON_ID)).toBeInTheDocument()
  })

  it('offers Undo on an active takedown', () => {
    render(<PersonRemovalList removals={[removal()]} />)

    expect(screen.getByText('Removed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('shows a restored row as history with no Undo', () => {
    render(
      <PersonRemovalList
        removals={[
          removal({
            clearedAt: '2026-08-10T00:00:00.000Z',
            clearedBy: 'privacy@goodparty.org',
          }),
        ]}
      />
    )

    expect(screen.getByText('Restored')).toBeInTheDocument()
    expect(screen.getByText('privacy@goodparty.org')).toBeInTheDocument()
    // A reverted takedown is a record, not a queue item — re-removing it goes
    // through the same confirmation flow as any new request.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('renders an em dash when no note was left', () => {
    render(<PersonRemovalList removals={[removal({ note: null })]} />)

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
