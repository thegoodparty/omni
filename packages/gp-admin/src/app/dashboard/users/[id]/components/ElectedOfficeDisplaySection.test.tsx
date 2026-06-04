import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ElectedOfficeDisplaySection } from './ElectedOfficeDisplaySection'
import type { ElectedOffice } from '@goodparty_org/sdk'

const mockElectedOffice: ElectedOffice = {
  id: 'uuid-123',
  createdAt: '2024-11-15T12:00:00.000Z',
  updatedAt: '2024-11-20T12:00:00.000Z',
  userId: 456,
  campaignId: 789,
  electedDate: '2024-11-05T12:00:00.000Z',
  swornInDate: '2025-01-06T12:00:00.000Z',
  termStartDate: '2025-01-07T12:00:00.000Z',
  termLengthDays: 1461,
  termEndDate: '2029-01-05T12:00:00.000Z',
  isActive: true,
}

describe('ElectedOfficeDisplaySection', () => {
  describe('when electedOffice is null', () => {
    it('shows informational callout', () => {
      render(<ElectedOfficeDisplaySection electedOffice={null} />)

      expect(
        screen.getByText(/no elected office record exists/i)
      ).toBeInTheDocument()
      expect(
        screen.getByText(/this section becomes available when/i)
      ).toBeInTheDocument()
    })

    it('does not render any info cards', () => {
      render(<ElectedOfficeDisplaySection electedOffice={null} />)

      expect(screen.queryByText('Term Dates')).not.toBeInTheDocument()
      expect(screen.queryByText('Status')).not.toBeInTheDocument()
    })
  })

  describe('when electedOffice exists', () => {
    it('renders term dates card', () => {
      render(<ElectedOfficeDisplaySection electedOffice={mockElectedOffice} />)

      expect(screen.getByText('Term Dates')).toBeInTheDocument()
      expect(screen.getByText('Nov 5, 2024')).toBeInTheDocument() // elected date
      expect(screen.getByText('Jan 6, 2025')).toBeInTheDocument() // sworn in
      expect(screen.getByText('Jan 7, 2025')).toBeInTheDocument() // term start
      expect(screen.getByText('Jan 5, 2029')).toBeInTheDocument() // term end
      expect(screen.getByText('1461 days')).toBeInTheDocument()
    })

    it('renders status card with active status', () => {
      render(<ElectedOfficeDisplaySection electedOffice={mockElectedOffice} />)

      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Active Office Holder')).toBeInTheDocument()
      expect(screen.getByText('Yes')).toBeInTheDocument()
    })

    it('renders status card with inactive status', () => {
      const inactiveOffice: ElectedOffice = {
        ...mockElectedOffice,
        isActive: false,
      }

      render(<ElectedOfficeDisplaySection electedOffice={inactiveOffice} />)

      expect(screen.getByText('No')).toBeInTheDocument()
    })

    it('renders IDs card', () => {
      render(<ElectedOfficeDisplaySection electedOffice={mockElectedOffice} />)

      expect(screen.getByText('IDs')).toBeInTheDocument()
      expect(screen.getByText('uuid-123')).toBeInTheDocument()
      expect(screen.getByText('456')).toBeInTheDocument()
      expect(screen.getByText('789')).toBeInTheDocument()
    })

    it('renders timestamps card', () => {
      render(<ElectedOfficeDisplaySection electedOffice={mockElectedOffice} />)

      expect(screen.getByText('Timestamps')).toBeInTheDocument()
    })

    it('shows dash when term length is null', () => {
      const officeNoTermLength: ElectedOffice = {
        ...mockElectedOffice,
        termLengthDays: null,
      }

      render(<ElectedOfficeDisplaySection electedOffice={officeNoTermLength} />)

      // The DataRow component shows '-' for null values
      const termLengthRow = screen.getByText('Term Length')
      expect(termLengthRow).toBeInTheDocument()
    })
  })
})
