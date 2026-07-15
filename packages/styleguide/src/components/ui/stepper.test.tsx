import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stepper } from './stepper'

describe('Stepper (bar)', () => {
  it('exposes progress semantics via role and aria attributes', () => {
    render(<Stepper variant="bar" currentStep={2} totalSteps={5} />)
    const progress = screen.getByRole('progressbar')
    expect(progress).toHaveAttribute('aria-valuemin', '1')
    expect(progress).toHaveAttribute('aria-valuemax', '5')
    expect(progress).toHaveAttribute('aria-valuenow', '2')
  })

  it('shows the "Step X of Y" label by default', () => {
    render(<Stepper variant="bar" currentStep={2} totalSteps={5} />)
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
  })

  it('hides the label when showLabel is false', () => {
    render(
      <Stepper
        variant="bar"
        currentStep={2}
        totalSteps={5}
        showLabel={false}
      />,
    )
    expect(screen.queryByText('Step 2 of 5')).not.toBeInTheDocument()
  })

  it('fills exactly currentStep segments', () => {
    const { container } = render(
      <Stepper variant="bar" currentStep={2} totalSteps={5} />,
    )
    const segments = container.querySelectorAll('[data-slot="stepper-segment"]')
    expect(segments).toHaveLength(5)
    const filled = [...segments].filter(
      (segment) =>
        segment.className.includes('bg-primary') &&
        !segment.className.includes('bg-primary/20'),
    )
    expect(filled).toHaveLength(2)
  })
})

describe('Stepper (vertical)', () => {
  const labels = ['Campaign EIN', 'Campaign details', 'Candidate profile']

  it('marks the current step with aria-current', () => {
    render(<Stepper variant="vertical" currentStep={2} labels={labels} />)
    const current = screen.getByText('Campaign details').closest('li')
    expect(current).toHaveAttribute('aria-current', 'step')
  })

  it('announces earlier steps as completed for assistive tech', () => {
    render(<Stepper variant="vertical" currentStep={2} labels={labels} />)
    const completed = screen.getByText('Campaign EIN').closest('li')
    expect(completed).toHaveAttribute('aria-label', 'Campaign EIN - completed')
    const upcoming = screen.getByText('Candidate profile').closest('li')
    expect(upcoming).not.toHaveAttribute('aria-label')
  })

  it('renders one indicator per label with 1-based step numbers', () => {
    render(<Stepper variant="vertical" currentStep={1} labels={labels} />)
    const indicators = screen.getAllByText(/^[1-9]$/)
    expect(indicators.map((el) => el.textContent)).toEqual(['1', '2', '3'])
  })

  it('defaults to the medium indicator size', () => {
    const { container } = render(
      <Stepper variant="vertical" currentStep={1} labels={labels} />,
    )
    const indicator = container.querySelector('[data-slot="stepper-indicator"]')
    expect(indicator).toHaveClass('size-10')
  })

  it('switches to the small indicator size', () => {
    const { container } = render(
      <Stepper
        variant="vertical"
        currentStep={1}
        labels={labels}
        size="small"
      />,
    )
    const indicator = container.querySelector('[data-slot="stepper-indicator"]')
    expect(indicator).toHaveClass('size-8')
  })
})
