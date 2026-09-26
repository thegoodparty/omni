import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from './PhoneBankingFlow'
import { gateRef } from '../gate/testing/mockReactiveGate'

vi.mock('../gate/useOutreachGate', async () => {
  const { useMockOutreachGate } =
    await import('../gate/testing/mockReactiveGate')
  return { useOutreachGate: useMockOutreachGate }
})

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// useOutreachAudience reads the org on mount and useOrganization throws
// without its provider — the same stand-in the sibling flow tests use.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))

const renderFlow = () =>
  render(
    <PhoneBankingFlow
      open
      onClose={vi.fn()}
      surface={SERVE_PHONE_BANKING_SURFACE}
    />,
  )

beforeEach(() => {
  gateRef.set({
    enabled: false,
    requirement: null,
    twoStep: true,
    membership: null,
    tcrCompliance: null,
  })
  api.mock('POST /v1/outreach/serve/phone-banking/draft', {
    status: 200,
    data: { draft: 'Hi, this is your council member.' },
  })
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
})

describe('PhoneBankingFlow community-input question step', () => {
  it('asks what the effort wants to learn after that purpose is picked', async () => {
    renderFlow()

    await userEvent.click(
      await screen.findByRole('button', { name: /Ask for community input/i }),
    )

    expect(await screen.findByLabelText('The question')).toBeVisible()
  })

  // Required by contract, so a blank question would 400 on save several
  // steps later with nothing on screen explaining why.
  it('holds Continue until a question is written', async () => {
    renderFlow()

    await userEvent.click(
      await screen.findByRole('button', { name: /Ask for community input/i }),
    )
    await screen.findByLabelText('The question')

    const cta = screen.getByRole('button', { name: 'Continue' })
    expect(cta).toBeDisabled()

    await userEvent.type(
      screen.getByPlaceholderText(/compost pilot/i),
      'Would you take part in a compost pilot?',
    )

    await waitFor(() => expect(cta).toBeEnabled())
  })

  // The Continue guard only checks emptiness, so a question left over from an
  // earlier pick would not trip it — it would ship as this effort's question.
  it('does not carry a question over to a later purpose pick', async () => {
    renderFlow()

    await userEvent.click(
      await screen.findByRole('button', { name: /Ask for community input/i }),
    )
    await userEvent.type(
      await screen.findByPlaceholderText(/compost pilot/i),
      'Would you take part in a compost pilot?',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(
      await screen.findByRole('button', { name: /Ask for community input/i }),
    )

    expect(await screen.findByLabelText('The question')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  // Every other purpose goes straight to the audience step, and its progress
  // bar has one fewer segment.
  it('skips the step for a purpose that asks nothing', async () => {
    renderFlow()

    await userEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/i }),
    )

    await waitFor(() =>
      expect(screen.queryByLabelText('The question')).toBeNull(),
    )
  })
})
