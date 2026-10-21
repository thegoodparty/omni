import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatCard } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { ProposalFlowsProvider, useProposalFlows } from './proposalFlows'

const mounted = vi.hoisted(() => ({
  sms: [] as Record<string, unknown>[],
  phoneBanking: [] as Record<string, unknown>[],
}))

// The flows are the outreach page's own and tested there; this asserts only
// what the card hands them.
vi.mock('app/dashboard/outreach/v2/sms/SmsFlow', () => ({
  SERVE_SMS_SURFACE: {},
  SmsFlow: (props: Record<string, unknown>) => {
    mounted.sms.push(props)
    return null
  },
}))
vi.mock('app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow', () => ({
  SERVE_PHONE_BANKING_SURFACE: {},
  PhoneBankingFlow: (props: Record<string, unknown>) => {
    mounted.phoneBanking.push(props)
    return null
  },
}))
vi.mock('app/dashboard/outreach/v2/social/SocialFlow', () => ({
  SERVE_SOCIAL_SURFACE: {},
  SocialFlow: () => null,
}))
vi.mock('@shared/experiments/serveSmsFlag', () => ({
  useServeSmsFlag: () => ({ ready: true, enabled: true }),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

type Proposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

const EVENT = { date: '2026-10-15', time: '18:00', location: 'Town hall' }

const card = (channel: Proposal['channel']): Proposal => ({
  kind: 'outreach_proposal',
  proposalKey: '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7',
  audience: 'Northside residents',
  count: 120,
  channel,
  savedFilterId: 41,
  message: 'this is Jane, your Council Member. Join us at town hall.',
  deepLinkOnly: false,
  event: EVENT,
})

const Opener = ({ proposal }: { proposal: Proposal }) => {
  const flows = useProposalFlows()
  return (
    <button type="button" onClick={() => flows?.open(proposal)}>
      Start
    </button>
  )
}

describe('ProposalFlowsProvider, an event invite', () => {
  it.each([
    ['text', 'sms'],
    ['phoneBanking', 'phoneBanking'],
  ] as const)(
    'opens the %s flow with the event details filled in',
    async (channel, flow) => {
      render(
        <ProposalFlowsProvider>
          <Opener proposal={card(channel)} />
        </ProposalFlowsProvider>,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))

      await waitFor(() => expect(mounted[flow].length).toBeGreaterThan(0))
      expect(mounted[flow].at(-1)).toMatchObject({ initialEvent: EVENT })
    },
  )
})
