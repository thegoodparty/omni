import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { RobocallFlow } from './RobocallFlow'

describe('RobocallFlow', () => {
  it('opens on the purpose step with the robocall purposes', () => {
    render(<RobocallFlow open onClose={vi.fn()} />)
    expect(screen.getByText('Introduce myself')).toBeInTheDocument()
    expect(screen.getByText('Persuade likely voters')).toBeInTheDocument()
  })

  it('advances to the placeholder step when a purpose is selected', () => {
    render(<RobocallFlow open onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Persuade likely voters'))
    expect(screen.getByText('More coming soon')).toBeInTheDocument()
    expect(screen.queryByText('Introduce myself')).not.toBeInTheDocument()
  })

  it('returns to the purpose step on Back', () => {
    render(<RobocallFlow open onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Persuade likely voters'))
    fireEvent.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Introduce myself')).toBeInTheDocument()
  })
})
