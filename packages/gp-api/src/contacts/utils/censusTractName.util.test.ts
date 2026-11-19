import { describe, expect, it } from 'vitest'
import { streetName, tractLabels } from './censusTractName.util'
import { neighborhoodOf } from '@/vendors/geoapify/services/geoapifyReverseGeocode.service'

describe('streetName', () => {
  it('title-cases the street name and designator', () => {
    expect(streetName({ street: 'HAYWOOD', designator: 'RD' })).toBe(
      'Haywood Rd',
    )
    expect(streetName({ street: '5TH', designator: null })).toBe('5th')
    expect(streetName({ street: null, designator: 'RD' })).toBeNull()
  })

  it('keeps a state route upper case, and leaves a county road alone', () => {
    expect(streetName({ street: 'NC 54', designator: null })).toBe('NC 54')
    expect(streetName({ street: 'NC HIGHWAY 55', designator: null })).toBe(
      'NC Highway 55',
    )
    expect(streetName({ street: 'TX 71', designator: null })).toBe('TX 71')
    expect(streetName({ street: 'CO RD 12', designator: null })).toBe(
      'Co Rd 12',
    )
    expect(streetName({ street: 'LA SALLE', designator: 'ST' })).toBe(
      'La Salle St',
    )
  })
})

describe('neighborhoodOf', () => {
  it('takes the most specific neighborhood field', () => {
    expect(
      neighborhoodOf({
        neighbourhood: 'Hawthorne',
        suburb: 'West Asheville',
        city: 'Asheville',
      }),
    ).toBe('Hawthorne')
  })

  it('never takes the city, the county or the road', () => {
    expect(
      neighborhoodOf({
        suburb: 'Asheville',
        district: 'Haywood Road',
        street: 'Haywood Road',
        city: 'Asheville',
      }),
    ).toBeNull()
    expect(
      neighborhoodOf({
        district: 'Buncombe County',
        county: 'Buncombe County',
      }),
    ).toBeNull()
  })
})

describe('tractLabels', () => {
  it('leaves unnamed tracts out and keeps distinct names', () => {
    const labels = tractLabels([
      {
        tractGeoid: '37021000100',
        name: 'Hawthorne',
        source: 'neighborhood',
        street: 'Haywood Rd',
      },
      {
        tractGeoid: '37021000200',
        name: 'around State St',
        source: 'street',
        street: 'State St',
      },
      { tractGeoid: '37021000300', name: null, source: 'none', street: null },
    ])
    expect([...labels]).toEqual([
      ['37021000100', 'Hawthorne'],
      ['37021000200', 'around State St'],
    ])
  })

  it('adds the tract number when two street names collide', () => {
    const labels = tractLabels([
      {
        tractGeoid: '37021002503',
        name: 'around Haywood Rd',
        source: 'street',
        street: 'Haywood Rd',
      },
      {
        tractGeoid: '37021002600',
        name: 'around Haywood Rd',
        source: 'street',
        street: 'Haywood Rd',
      },
    ])
    expect([...labels.values()]).toEqual([
      'around Haywood Rd (Tract 25.03)',
      'around Haywood Rd (Tract 26)',
    ])
  })
})
