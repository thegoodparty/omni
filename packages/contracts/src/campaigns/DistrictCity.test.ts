import { describe, expect, it } from 'vitest'
import { cityFromDistrictName, cityNameCase } from './DistrictCity'

describe('cityFromDistrictName', () => {
  it.each([
    ['Fayetteville Ward 4', 'Fayetteville'],
    ['City of Kyle', 'Kyle'],
    ['Pocatello City (Est.)', 'Pocatello'],
    ['Dubuque City Ward 3', 'Dubuque'],
    ['Ward Town', 'Ward'],
    ['Council City (Est.)', 'Council'],
  ])('names the place in %s', (district, place) => {
    expect(cityFromDistrictName(district)).toBe(place)
  })

  it.each(['05', ''])('names no place for %s', (district) => {
    expect(cityFromDistrictName(district)).toBeNull()
  })
})

describe('cityNameCase', () => {
  it.each([
    ['FAYETTEVILLE', 'Fayetteville'],
    ['WINSTON-SALEM', 'Winston-Salem'],
    ['MCALLEN', 'McAllen'],
    ["O'FALLON", "O'Fallon"],
    ["D'IBERVILLE", "D'Iberville"],
    ["PRINCE GEORGE'S", "Prince George's"],
    ['ISLE OF PALMS', 'Isle of Palms'],
    ['THE VILLAGES', 'The Villages'],
    ['CHAPEL HILL', 'Chapel Hill'],
  ])('title-cases %s', (name, cased) => {
    expect(cityNameCase(name)).toBe(cased)
  })

  it.each(['Fayetteville', 'McAllen', 'Isle Of Palms', 'DeKalb', '05'])(
    'leaves %s as it arrived',
    (name) => {
      expect(cityNameCase(name)).toBe(name)
    },
  )
})
