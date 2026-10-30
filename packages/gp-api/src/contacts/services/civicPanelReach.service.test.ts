import { describe, expect, it } from 'vitest'
import { reachOptionWords } from './civicPanelReach.service'

const tract = (label: string) =>
  ({
    kind: 'place',
    key: '37021000100',
    place: {
      key: '37021000100',
      name: '0001.00',
      label,
      districtShare: 0.5,
      members: 1,
    },
    have: 4,
    need: 5,
  }) as const

describe('reachOptionWords', () => {
  it('names a place in or around it, one seat and one home', () => {
    expect(
      reachOptionWords(tract('West Asheville'), 'West Asheville', 'door', 1),
    ).toEqual({
      label: 'Knock doors in West Asheville',
      detail: '1 seat short. 1 home there has no cell phone on file.',
    })
    expect(
      reachOptionWords(
        tract('around Pine St'),
        'around Pine St',
        'phone',
        1200,
      ),
    ).toEqual({
      label: 'Call residents around Pine St',
      detail: '1 seat short. 1,200 homes there have a landline.',
    })
  })

  it('calls a group by its name', () => {
    expect(
      reachOptionWords(
        { kind: 'group', key: 'black', group: 'black', have: 1, need: 9 },
        'Black residents',
        'phone',
        30,
      ),
    ).toEqual({
      label: 'Call Black residents',
      detail: '8 seats short. 30 of their homes have a landline.',
    })
  })
})
