import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { P2VSection } from './P2VSection'
import type { PathToVictory } from '../types/p2v'

const mockP2V: PathToVictory = {
  id: 771,
  createdAt: '2024-05-10T02:01:15.810Z',
  updatedAt: '2025-08-13T20:43:03.191Z',
  campaignId: 1,
  data: {
    p2vStatus: 'Complete',
    electionType: 'City',
    electionLocation: 'HENDERSONVILLE CITY',
    source: 'ElectionApi',
    p2vCompleteDate: '2025-08-13',
    winNumber: 3142,
    voterContactGoal: 15710,
    totalRegisteredVoters: 53278,
    projectedTurnout: 6282,
    averageTurnout: 16291,
    republicans: 6991,
    democrats: 30017,
    indies: 16270,
    men: 23793,
    women: 25651,
    white: 10138,
    asian: 13145,
    africanAmerican: 318,
    hispanic: 18755,
    viability: {
      level: 'city',
      score: 2.25,
      seats: 1,
      candidates: '',
      isPartisan: false,
      isIncumbent: '',
      isUncontested: '',
      candidatesPerSeat: '',
    },
  },
}

describe('P2VSection', () => {
  describe('when p2v is null', () => {
    it('shows no data message', () => {
      render(<P2VSection p2v={null} />)

      expect(
        screen.getByText('No Path to Victory data available.')
      ).toBeInTheDocument()
    })
  })

  describe('when p2v exists', () => {
    it('renders P2V status card', () => {
      render(<P2VSection p2v={mockP2V} />)

      expect(screen.getByText('P2V Status')).toBeInTheDocument()
      expect(screen.getByText('Complete')).toBeInTheDocument()
      expect(screen.getByText('City')).toBeInTheDocument()
      expect(screen.getByText('HENDERSONVILLE CITY')).toBeInTheDocument()
      expect(screen.getByText('ElectionApi')).toBeInTheDocument()
    })

    it('renders target numbers card', () => {
      render(<P2VSection p2v={mockP2V} />)

      expect(screen.getByText('Target Numbers')).toBeInTheDocument()
      expect(screen.getByText('Win Number')).toBeInTheDocument()
      expect(screen.getByText('3,142')).toBeInTheDocument()
      expect(screen.getByText('15,710')).toBeInTheDocument() // voter contact goal
      expect(screen.getByText('53,278')).toBeInTheDocument() // total registered
    })

    it('renders party demographics card', () => {
      render(<P2VSection p2v={mockP2V} />)

      expect(
        screen.getByText('Demographics - Party Affiliation')
      ).toBeInTheDocument()
      expect(screen.getByText('Republicans')).toBeInTheDocument()
      expect(screen.getByText('Democrats')).toBeInTheDocument()
      expect(screen.getByText('Independents')).toBeInTheDocument()
      expect(screen.getByText('6,991')).toBeInTheDocument()
      expect(screen.getByText('30,017')).toBeInTheDocument()
      expect(screen.getByText('16,270')).toBeInTheDocument()
    })

    it('renders gender demographics card', () => {
      render(<P2VSection p2v={mockP2V} />)

      expect(screen.getByText('Demographics - Gender')).toBeInTheDocument()
      expect(screen.getByText('Men')).toBeInTheDocument()
      expect(screen.getByText('Women')).toBeInTheDocument()
      expect(screen.getByText('23,793')).toBeInTheDocument()
      expect(screen.getByText('25,651')).toBeInTheDocument()
    })

    it('renders race demographics card', () => {
      render(<P2VSection p2v={mockP2V} />)

      expect(
        screen.getByText('Demographics - Race/Ethnicity')
      ).toBeInTheDocument()
      expect(screen.getByText('White')).toBeInTheDocument()
      expect(screen.getByText('Asian')).toBeInTheDocument()
      expect(screen.getByText('African American')).toBeInTheDocument()
      expect(screen.getByText('Hispanic')).toBeInTheDocument()
    })

    it('renders viability analysis card', () => {
      render(<P2VSection p2v={mockP2V} />)

      expect(screen.getByText('Viability Analysis')).toBeInTheDocument()
      expect(screen.getByText('city')).toBeInTheDocument() // level
      expect(screen.getByText('2.25')).toBeInTheDocument() // score
      expect(screen.getByText('Partisan')).toBeInTheDocument()
      expect(screen.getByText('Incumbent')).toBeInTheDocument()
      expect(screen.getByText('Uncontested')).toBeInTheDocument()
    })

    it('handles string win number', () => {
      const p2vStringWin: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          winNumber: '5000',
        },
      }

      render(<P2VSection p2v={p2vStringWin} />)

      expect(screen.getByText('5,000')).toBeInTheDocument()
    })

    it('handles missing viability data', () => {
      const p2vNoViability: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          viability: undefined,
        },
      }

      render(<P2VSection p2v={p2vNoViability} />)

      expect(screen.queryByText('Viability Analysis')).not.toBeInTheDocument()
    })

    it('handles zero total registered voters', () => {
      const p2vZeroVoters: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          totalRegisteredVoters: 0,
          republicans: 0,
          democrats: 0,
          indies: 0,
        },
      }

      render(<P2VSection p2v={p2vZeroVoters} />)

      // Should render with 0.0% of registered voters
      expect(screen.getByText('0.0% of registered voters')).toBeInTheDocument()
    })

    it('renders non-complete P2V status', () => {
      const p2vProcessing: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          p2vStatus: 'Processing',
        },
      }

      render(<P2VSection p2v={p2vProcessing} />)

      expect(screen.getByText('Processing')).toBeInTheDocument()
    })

    it('renders Not set when p2vStatus is missing', () => {
      const p2vNoStatus: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          p2vStatus: undefined,
        },
      }

      render(<P2VSection p2v={p2vNoStatus} />)

      expect(screen.getByText('Not set')).toBeInTheDocument()
    })

    it('renders viability with isPartisan true', () => {
      const p2vPartisan: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          viability: {
            ...mockP2V.data.viability!,
            isPartisan: true,
          },
        },
      }

      render(<P2VSection p2v={p2vPartisan} />)

      expect(screen.getByText('Viability Analysis')).toBeInTheDocument()
    })

    it('renders viability with isIncumbent true', () => {
      const p2vIncumbent: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          viability: {
            ...mockP2V.data.viability!,
            isIncumbent: 'true',
          },
        },
      }

      render(<P2VSection p2v={p2vIncumbent} />)

      expect(screen.getByText('Viability Analysis')).toBeInTheDocument()
    })

    it('renders viability with isUncontested true', () => {
      const p2vUncontested: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          viability: {
            ...mockP2V.data.viability!,
            isUncontested: 'true',
          },
        },
      }

      render(<P2VSection p2v={p2vUncontested} />)

      expect(screen.getByText('Viability Analysis')).toBeInTheDocument()
    })

    it('handles missing winNumber', () => {
      const p2vNoWin: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          winNumber: undefined,
        },
      }

      render(<P2VSection p2v={p2vNoWin} />)

      // Should render with 0 win number
      expect(screen.getByText('Win Number')).toBeInTheDocument()
    })

    it('handles missing party affiliation data', () => {
      const p2vNoPartyData: PathToVictory = {
        ...mockP2V,
        data: {
          ...mockP2V.data,
          republicans: undefined,
          democrats: undefined,
          indies: undefined,
        },
      }

      render(<P2VSection p2v={p2vNoPartyData} />)

      expect(screen.getByText('Republicans')).toBeInTheDocument()
      expect(screen.getByText('Democrats')).toBeInTheDocument()
      expect(screen.getByText('Independents')).toBeInTheDocument()
    })
  })
})
