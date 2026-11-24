import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeamBadge } from './team-badge'

describe('TeamBadge', () => {
  it('is a labelled image in the primary colors', () => {
    render(<TeamBadge />)
    const badge = screen.getByRole('img', { name: 'TEAM' })
    expect(badge).toHaveAttribute('data-slot', 'team-badge')
    expect(badge).toHaveAttribute('viewBox', '0 0 62.5 22')
    expect(badge.querySelector('.fill-primary')).not.toBeNull()
    expect(badge.querySelector('.fill-primary-foreground')).not.toBeNull()
  })

  it.each([
    ['small', 'w-[34px]', 'h-[12px]'],
    ['default', 'w-[45px]', 'h-[16px]'],
    ['large', 'w-[57px]', 'h-[20px]'],
  ] as const)('renders the %s size', (size, width, height) => {
    render(<TeamBadge size={size} />)
    const badge = screen.getByRole('img', { name: 'TEAM' })
    expect(badge).toHaveClass(width, height)
  })

  it('defaults to the default size', () => {
    render(<TeamBadge />)
    expect(screen.getByRole('img', { name: 'TEAM' })).toHaveClass(
      'w-[45px]',
      'h-[16px]',
    )
  })

  it('lets a caller override the size', () => {
    render(<TeamBadge size="large" className="h-[30px] w-[85px]" />)
    expect(screen.getByRole('img', { name: 'TEAM' })).toHaveClass(
      'h-[30px]',
      'w-[85px]',
    )
  })
})
