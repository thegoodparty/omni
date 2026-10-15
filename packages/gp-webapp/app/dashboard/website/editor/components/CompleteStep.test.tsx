import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import CompleteStep from './CompleteStep'

vi.mock('@shared/animations/HighFiveAnimation', () => ({
  default: () => null,
}))

const renderStep = (smsCompliance: Campaign['smsCompliance']) =>
  render(
    <CampaignContext.Provider value={[{ smsCompliance } as Campaign]}>
      <CompleteStep vanityPath="jane-doe" domain={null} />
    </CampaignContext.Provider>,
  )

describe('CompleteStep', () => {
  it('pitches texting with the domain while texting is open', () => {
    renderStep('open')

    expect(screen.getByText('Get 5,000 texts')).toBeInTheDocument()
    expect(screen.getByText('Make your campaign compliant')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'texting' })).toBeInTheDocument()
  })

  it('drops the texting pitch from the domain card once texting has closed', () => {
    renderStep('closed')

    expect(screen.queryByText('Get 5,000 texts')).toBeNull()
    expect(screen.queryByText('Make your campaign compliant')).toBeNull()
    expect(screen.queryByRole('img', { name: 'texting' })).toBeNull()
    expect(screen.getByText('Target the right voters')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a domain' })).toHaveAttribute(
      'href',
      '/dashboard/website/domain',
    )
  })
})
