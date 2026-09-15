import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import BriefingDispatchBanner from './BriefingDispatchBanner'

// The dispatch and poll behavior lives in useBriefingDispatch and is tested
// there. This is the presentation only.
describe('<BriefingDispatchBanner>', () => {
  it('announces a briefing that is generating', () => {
    render(<BriefingDispatchBanner inFlight />)
    expect(screen.getByText(/generating your briefing/i)).toBeInTheDocument()
    expect(
      screen.getByText(/we'll email you when it's ready/i),
    ).toBeInTheDocument()
  })

  it('renders nothing when no briefing is in flight', () => {
    const { container } = render(<BriefingDispatchBanner inFlight={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  // docs/product-copy.md: no em dashes.
  it('carries no em-dash', () => {
    const { container } = render(<BriefingDispatchBanner inFlight />)
    expect(container.textContent).not.toContain('—')
  })
})
