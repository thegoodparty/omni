import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { PathToVictoryDisplaySection } from './PathToVictoryDisplaySection'
import { renderWithUser, mockUserNoP2V } from './test-utils'

describe('PathToVictoryDisplaySection', () => {
  describe('when P2V data exists', () => {
    describe('p2v status card', () => {
      it('renders P2V status card', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('P2V Status')).toBeInTheDocument()
      })

      it('displays status badge as Complete', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Status')).toBeInTheDocument()
        expect(screen.getByText('Complete')).toBeInTheDocument()
      })

      it('displays election type', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Election Type')).toBeInTheDocument()
        expect(screen.getByText('City')).toBeInTheDocument()
      })

      it('displays election location', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Election Location')).toBeInTheDocument()
        expect(screen.getByText('TEST CITY')).toBeInTheDocument()
      })
    })

    describe('target numbers card', () => {
      it('renders target numbers card', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Target Numbers')).toBeInTheDocument()
      })

      it('displays win number', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Win Number')).toBeInTheDocument()
        expect(screen.getByText('3,142')).toBeInTheDocument()
      })

      it('displays voter contact goal', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Voter Contact Goal')).toBeInTheDocument()
        expect(screen.getByText('15,710')).toBeInTheDocument()
      })

      it('displays total registered voters', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Total Registered Voters')).toBeInTheDocument()
        expect(screen.getByText('53,278')).toBeInTheDocument()
      })

      it('displays projected turnout', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Projected Turnout')).toBeInTheDocument()
        expect(screen.getByText('6,282')).toBeInTheDocument()
      })

      it('displays average turnout', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Average Turnout')).toBeInTheDocument()
        expect(screen.getByText('16,291')).toBeInTheDocument()
      })
    })

    describe('party affiliation card', () => {
      it('renders party affiliation card', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(
          screen.getByText('Demographics - Party Affiliation')
        ).toBeInTheDocument()
      })

      it('displays republicans count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Republicans')).toBeInTheDocument()
        expect(screen.getByText('6,991')).toBeInTheDocument()
      })

      it('displays democrats count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Democrats')).toBeInTheDocument()
        expect(screen.getByText('30,017')).toBeInTheDocument()
      })

      it('displays independents count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Independents')).toBeInTheDocument()
        expect(screen.getByText('16,270')).toBeInTheDocument()
      })
    })

    describe('gender demographics card', () => {
      it('renders gender demographics card', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Demographics - Gender')).toBeInTheDocument()
      })

      it('displays men count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Men')).toBeInTheDocument()
        expect(screen.getByText('23,793')).toBeInTheDocument()
      })

      it('displays women count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Women')).toBeInTheDocument()
        expect(screen.getByText('25,651')).toBeInTheDocument()
      })
    })

    describe('race/ethnicity demographics card', () => {
      it('renders race/ethnicity demographics card', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(
          screen.getByText('Demographics - Race/Ethnicity')
        ).toBeInTheDocument()
      })

      it('displays white count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('White')).toBeInTheDocument()
        expect(screen.getByText('10,138')).toBeInTheDocument()
      })

      it('displays asian count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Asian')).toBeInTheDocument()
        expect(screen.getByText('13,145')).toBeInTheDocument()
      })

      it('displays african american count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('African American')).toBeInTheDocument()
        expect(screen.getByText('318')).toBeInTheDocument()
      })

      it('displays hispanic count', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Hispanic')).toBeInTheDocument()
        expect(screen.getByText('18,755')).toBeInTheDocument()
      })
    })

    describe('viability analysis card', () => {
      it('renders viability analysis card', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Viability Analysis')).toBeInTheDocument()
      })

      it('displays viability level', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Level')).toBeInTheDocument()
      })

      it('displays viability score', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Score')).toBeInTheDocument()
        expect(screen.getByText('2.25')).toBeInTheDocument()
      })

      it('displays seats', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Seats')).toBeInTheDocument()
      })

      it('displays partisan status', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Partisan')).toBeInTheDocument()
      })

      it('displays incumbent status', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Incumbent')).toBeInTheDocument()
      })

      it('displays uncontested status', () => {
        renderWithUser(<PathToVictoryDisplaySection />)

        expect(screen.getByText('Uncontested')).toBeInTheDocument()
      })
    })
  })

  describe('when P2V data does not exist', () => {
    it('displays no data message', () => {
      renderWithUser(<PathToVictoryDisplaySection />, mockUserNoP2V)

      expect(screen.getByText('Path to Victory')).toBeInTheDocument()
      expect(
        screen.getByText('No Path to Victory data available.')
      ).toBeInTheDocument()
    })

    it('does not render target numbers', () => {
      renderWithUser(<PathToVictoryDisplaySection />, mockUserNoP2V)

      expect(screen.queryByText('Target Numbers')).not.toBeInTheDocument()
    })
  })
})
