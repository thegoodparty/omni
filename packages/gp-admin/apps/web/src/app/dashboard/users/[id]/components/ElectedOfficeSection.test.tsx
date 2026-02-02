import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { ElectedOfficeSection } from './ElectedOfficeSection'
import { renderWithUser, mockUserNoElectedOffice } from './test-utils'

describe('ElectedOfficeSection', () => {
  describe('when user has won election (hasElectedOffice = true)', () => {
    it('renders term dates card', () => {
      renderWithUser(<ElectedOfficeSection />)

      expect(screen.getByText('Term Dates')).toBeInTheDocument()
    })

    it('displays elected date field', () => {
      renderWithUser(<ElectedOfficeSection />)

      expect(screen.getByText('Elected Date')).toBeInTheDocument()
    })

    it('displays sworn in date field', () => {
      renderWithUser(<ElectedOfficeSection />)

      expect(screen.getByText('Sworn In Date')).toBeInTheDocument()
    })

    it('displays term start date field', () => {
      renderWithUser(<ElectedOfficeSection />)

      expect(screen.getByText('Term Start Date')).toBeInTheDocument()
    })

    it('displays term end date field', () => {
      renderWithUser(<ElectedOfficeSection />)

      expect(screen.getByText('Term End Date')).toBeInTheDocument()
    })

    it('displays term length field', () => {
      renderWithUser(<ElectedOfficeSection />)

      expect(screen.getByText('Term Length')).toBeInTheDocument()
    })

    it('renders status card', () => {
      renderWithUser(<ElectedOfficeSection />)

      expect(screen.getByText('Status')).toBeInTheDocument()
    })

    it('displays active office holder status', () => {
      renderWithUser(<ElectedOfficeSection />)

      expect(screen.getByText('Active Office Holder')).toBeInTheDocument()
    })

    it('shows dash for empty date fields', () => {
      renderWithUser(<ElectedOfficeSection />)

      // Multiple dashes should be present for empty date fields
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThan(0)
    })
  })

  describe('when user has not won election (hasElectedOffice = false)', () => {
    it('displays info callout message', () => {
      renderWithUser(<ElectedOfficeSection />, mockUserNoElectedOffice)

      expect(
        screen.getByText(/No elected office record exists/)
      ).toBeInTheDocument()
    })

    it('explains when section becomes available', () => {
      renderWithUser(<ElectedOfficeSection />, mockUserNoElectedOffice)

      expect(
        screen.getByText(
          /This section becomes available when the candidate wins their election/
        )
      ).toBeInTheDocument()
    })

    it('does not render term dates card', () => {
      renderWithUser(<ElectedOfficeSection />, mockUserNoElectedOffice)

      expect(screen.queryByText('Term Dates')).not.toBeInTheDocument()
    })

    it('does not render status card', () => {
      renderWithUser(<ElectedOfficeSection />, mockUserNoElectedOffice)

      expect(screen.queryByText('Active Office Holder')).not.toBeInTheDocument()
    })
  })
})
