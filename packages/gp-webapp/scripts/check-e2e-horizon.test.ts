import { describe, expect, it } from 'vitest'
import realWorldReferences from '../e2e-tests/src/real-world-references.json'
import {
  assessReference,
  HORIZON_DAYS,
  renderSummary,
  utcToday,
} from './check-e2e-horizon.mjs'

const TODAY = Date.UTC(2026, 9, 23)

const race = (
  name: string,
  electionDay: string,
  kind: 'general' | 'primary' | 'runoff' = 'general',
) => ({
  id: `${name}-${electionDay}-${kind}`,
  brPositionId: 'pos',
  position: { name, level: 'city', state: 'NC' },
  election: { electionDay },
  isPrimary: kind !== 'general',
  isRunoff: kind === 'runoff',
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
    zip: '28202',
    office: 'Charlotte City Mayor',
    needs: 'upcoming',
    minRaces: 2,
    usedBy: 'office-picker-28202',
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
    expect(verdict).toMatchObject({
      ok: false,
      detail: 'No upcoming general race.',
    })
  })

  it('does not count primaries or runoffs, which the Win picker hides', () => {
    const verdict = assessReference(
      mayor,
      {
        future: [
          race(mayor.office, '2027-09-14', 'primary'),
          race(mayor.office, '2027-10-05', 'runoff'),
          race(mayor.office, '2027-11-02'),
        ],
        past: [],
      },
      TODAY,
    )
    expect(verdict).toMatchObject({ ok: false, next: '2027-11-02' })
    expect(verdict.detail).toMatch(/has 1\./)
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
      zip: '28202',
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
          race('B', '2027-11-02'),
          race('C', '2027-11-02'),
        ],
        past: [],
      },
      TODAY,
    )
    expect(later).toMatchObject({ ok: true, next: '2026-11-03' })
  })

  // Cheyenne (82001) in October 2026: generals on Nov 3, then only 2028
  // primaries. The Win picker lists nothing there from Nov 4.
  const cheyenne = {
    future: [
      race('Laramie County 1 School Board - Area 2', '2026-11-03'),
      race(
        'Wyoming House of Representatives - District 8',
        '2028-08-22',
        'primary',
      ),
      race(
        'Wyoming House of Representatives - District 9',
        '2028-08-22',
        'primary',
      ),
    ],
    past: [],
  }

  it('fails a zip whose only clear races are primaries', () => {
    const verdict = assessReference(
      {
        id: 'picker',
        zip: '82001',
        needs: 'upcoming',
        minOffices: 2,
        usedBy: 'onboarding',
      },
      cheyenne,
      TODAY,
    )
    expect(verdict).toMatchObject({ ok: false, next: '2026-11-03' })
    expect(verdict.detail).toMatch(/general race/)
    expect(verdict.detail).toMatch(/has 0\. Next is 2026-11-03, 11 days away/)
  })

  it('counts primaries for a reference that opts in', () => {
    const verdict = assessReference(
      {
        id: 'serve-picker',
        zip: '82001',
        needs: 'upcoming',
        includePrimaries: true,
        minOffices: 2,
        usedBy: 'serve-onboarding',
      },
      cheyenne,
      TODAY,
    )
    expect(verdict).toMatchObject({
      ok: true,
      next: '2026-11-03',
      detail: '2 office(s) clear.',
    })
  })

  it('matches a role by substring', () => {
    const council = {
      id: 'council',
      zip: '28202',
      officeContains: 'City Council',
      needs: 'upcoming',
      usedBy: 'office-picker-28202',
    }
    const other = assessReference(
      council,
      {
        future: [race('Charlotte-Mecklenburg School Board', '2027-11-02')],
        past: [],
      },
      TODAY,
    )
    expect(other.ok).toBe(false)

    const matching = assessReference(
      council,
      {
        future: [
          race('Charlotte City Council - District 1', '2027-09-14', 'primary'),
          race('Charlotte City Council - District 1', '2027-11-02'),
        ],
        past: [],
      },
      TODAY,
    )
    expect(matching).toMatchObject({
      ok: true,
      next: '2027-11-02',
      detail: '1 office(s) clear.',
    })
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
            zip: '28202',
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
