import { describe, expect, it } from 'vitest'
import realWorldReferences from '../e2e-tests/src/real-world-references.json'
import {
  assessReference,
  HORIZON_DAYS,
  renderSummary,
  utcToday,
} from './check-e2e-horizon.mjs'

const TODAY = Date.UTC(2026, 9, 23)

const race = (name: string, electionDay: string) => ({
  id: `${name}-${electionDay}`,
  brPositionId: 'pos',
  position: { name, level: 'city', state: 'WY' },
  election: { electionDay },
})

describe('assessReference', () => {
  const exists = {
    id: 'default-office',
    zip: '82001',
    office: 'Cheyenne City Council - Ward 1',
    needs: 'exists',
    usedBy: 'everything',
  }

  it('passes an office that only has past races', () => {
    const verdict = assessReference(
      exists,
      { future: [], past: [race(exists.office, '2026-11-03')] },
      Date.UTC(2026, 10, 10),
    )
    expect(verdict).toMatchObject({ ok: true, next: null })
  })

  it('fails an office that no longer resolves at all', () => {
    const verdict = assessReference(
      exists,
      { future: [race('Other', '2027-01-01')], past: [] },
      TODAY,
    )
    expect(verdict.ok).toBe(false)
  })

  const mayor = {
    id: 'mayor',
    zip: '28806',
    office: 'Asheville City Mayor',
    needs: 'upcoming',
    minRaces: 2,
    usedBy: 'office-picker-28806',
  }

  it(`fails a picked office whose next race is under ${HORIZON_DAYS} days away`, () => {
    const verdict = assessReference(
      mayor,
      {
        future: [
          race(mayor.office, '2026-11-03'),
          race(mayor.office, '2026-11-03'),
        ],
        past: [],
      },
      TODAY,
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toMatch(/11 days away/)
  })

  it('fails a picked office with no upcoming race', () => {
    const verdict = assessReference(mayor, { future: [], past: [] }, TODAY)
    expect(verdict).toMatchObject({ ok: false, detail: 'No upcoming race.' })
  })

  it('passes when enough races sit beyond the horizon', () => {
    const verdict = assessReference(
      mayor,
      {
        future: [
          race(mayor.office, '2027-11-02'),
          race(mayor.office, '2027-11-02'),
        ],
        past: [],
      },
      TODAY,
    )
    expect(verdict).toMatchObject({ ok: true, next: '2027-11-02' })
  })

  it('counts distinct clear offices for a zip-wide reference', () => {
    const picker = {
      id: 'picker',
      zip: '82001',
      needs: 'upcoming',
      minOffices: 2,
      usedBy: 'onboarding',
    }
    const soon = assessReference(
      picker,
      {
        future: [race('A', '2026-11-03'), race('B', '2026-11-03')],
        past: [],
      },
      TODAY,
    )
    expect(soon.ok).toBe(false)

    const later = assessReference(
      picker,
      {
        future: [
          race('A', '2026-11-03'),
          race('B', '2028-08-22'),
          race('C', '2028-08-22'),
        ],
        past: [],
      },
      TODAY,
    )
    expect(later).toMatchObject({ ok: true, next: '2026-11-03' })
  })

  it('matches a role by substring', () => {
    const council = {
      id: 'council',
      zip: '28806',
      officeContains: 'City Council',
      needs: 'upcoming',
      usedBy: 'office-picker-28806',
    }
    const verdict = assessReference(
      council,
      { future: [race('Woodfin Town Council', '2027-11-02')], past: [] },
      TODAY,
    )
    expect(verdict.ok).toBe(false)
  })
})

describe('real-world-references.json', () => {
  it('watches the default office the e2e helpers create campaigns on', () => {
    const { defaultOffice, references } = realWorldReferences
    expect(references).toContainEqual(
      expect.objectContaining({
        zip: defaultOffice.zip,
        office: defaultOffice.office,
      }),
    )
  })

  it('gives every reference a unique id and a known need', () => {
    const ids = realWorldReferences.references.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const reference of realWorldReferences.references) {
      expect(['exists', 'upcoming']).toContain(reference.needs)
    }
  })
})

describe('renderSummary', () => {
  it('names the failing references', () => {
    const summary = renderSummary(
      [
        {
          reference: {
            id: 'mayor',
            zip: '28806',
            needs: 'upcoming',
            usedBy: 'x',
          },
          verdict: { ok: false, next: null, detail: 'No upcoming race.' },
        },
      ],
      utcToday(new Date('2026-10-23T12:00:00Z')),
    )
    expect(summary).toContain('1 reference(s) need attention')
    expect(summary).toContain('FAIL: No upcoming race.')
  })
})
