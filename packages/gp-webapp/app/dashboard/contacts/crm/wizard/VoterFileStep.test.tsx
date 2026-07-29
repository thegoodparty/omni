import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import VoterFileStep from './VoterFileStep'
import type { SupportStatusRollup } from '../shared/contacts-types'

// ENG-10837: the Support status section shows all five SupportStatusRollup
// values (product decision 2026-07-28) — the prototype's 3-pill section is
// deliberately superseded, not "fixed back".
describe('VoterFileStep — Support status pills', () => {
  it('renders Supporter, Non-supporter, Undecided, Refused, and Support Unknown', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={vi.fn()}
        supportStatus={[]}
        onSupportStatusChange={vi.fn()}
        isElectedOfficial={false}
      />,
    )

    for (const label of [
      'Supporter',
      'Non-supporter',
      'Undecided',
      'Refused',
      'Support Unknown',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('toggling Undecided reports it via onSupportStatusChange', async () => {
    const user = userEvent.setup()
    const onSupportStatusChange = vi.fn()

    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={vi.fn()}
        supportStatus={[]}
        onSupportStatusChange={onSupportStatusChange}
        isElectedOfficial={false}
      />,
    )

    await user.click(screen.getByText('Undecided'))

    expect(onSupportStatusChange).toHaveBeenCalledWith([
      'undecided',
    ] as SupportStatusRollup[])
  })
})
