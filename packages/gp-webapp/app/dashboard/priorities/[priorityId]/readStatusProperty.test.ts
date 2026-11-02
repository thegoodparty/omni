import { describe, expect, it } from 'vitest'
import type { PriorityReadStatus } from '@goodparty_org/contracts'
import {
  outreachProposedProperties,
  readProperties,
} from './readStatusProperty'

const read = (overrides: Partial<PriorityReadStatus>): PriorityReadStatus => ({
  answers: 24,
  needed: 96,
  groupsHeard: 3,
  groupsTotal: 12,
  good: false,
  status: 'tooEarly',
  underrepresented: [],
  ...overrides,
})

describe('readProperties', () => {
  it('reads waiting with the groups still short', () => {
    expect(readProperties(read({}))).toEqual({
      readStatus: 'waiting',
      groupsShort: 9,
    })
  })

  it('reads good once the read is good', () => {
    expect(readProperties(read({ good: true, groupsHeard: 12 }))).toMatchObject(
      { readStatus: 'good', groupsShort: 0 },
    )
  })

  it('adds nothing without a read', () => {
    expect(readProperties(null)).toEqual({})
  })
})

describe('outreachProposedProperties', () => {
  const card = {
    audience: 'Households on Maple St',
    count: 400,
    channel: 'text',
    message: 'Hi {First name}, what do you think?',
  }

  it('describes a first ask to a sample', () => {
    expect(
      outreachProposedProperties({ ...card, sampleSize: 120, side: 'main' }),
    ).toEqual({
      round: 'one',
      sampleSize: 120,
      targetGroup: 'main',
      channel: 'text',
    })
  })

  it('calls an ask that widens an earlier one a follow-up', () => {
    expect(
      outreachProposedProperties({
        ...card,
        channel: 'doorKnocking',
        widensOutreachIds: [7],
        areaTarget: 'unreached',
      }),
    ).toEqual({
      round: 'follow_up',
      sampleSize: 400,
      targetGroup: 'unreached_areas',
      channel: 'door',
    })
  })

  it('skips a report back and a social post', () => {
    expect(
      outreachProposedProperties({ ...card, reportBackForOutreachId: 3 }),
    ).toBeNull()
    expect(
      outreachProposedProperties({ ...card, channel: 'social' }),
    ).toBeNull()
  })
})
