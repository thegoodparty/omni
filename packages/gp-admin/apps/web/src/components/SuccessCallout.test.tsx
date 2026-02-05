import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SuccessCallout } from './SuccessCallout'

describe('SuccessCallout', () => {
  it('displays the success message when visible', () => {
    render(<SuccessCallout visible={true} message="Changes saved" />)
    expect(screen.getByText('Changes saved')).toBeVisible()
  })

  it('does not render when not visible', () => {
    render(<SuccessCallout visible={false} message="Changes saved" />)
    expect(screen.queryByText('Changes saved')).not.toBeInTheDocument()
  })
})
