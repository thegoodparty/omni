import { describe, expect, it } from 'vitest'
import type { PriorityReadStatus } from '@goodparty_org/contracts'
import { READ_STATUS_COPY } from './readStatusCopy'

const read = (overrides: Partial<PriorityReadStatus>): PriorityReadStatus => ({
  answers: 40,
  needed: 60,
  groupsHeard: 8,
  groupsTotal: 12,
  good: false,
  status: 'tooEarly',
  underrepresented: [],
  checkOut: true,
  ...overrides,
})

describe('READ_STATUS_COPY.statusLine', () => {
  it('says it still needs to hear from a group with no answers', () => {
    expect(
      READ_STATUS_COPY.statusLine(
        read({ underrepresented: ['men'], unheard: ['men'] }),
      ),
    ).toBe('Still need to hear from men')
  })

  it('asks for a few more answers from a group that has some', () => {
    expect(
      READ_STATUS_COPY.statusLine(
        read({ underrepresented: ['men'], unheard: [] }),
      ),
    ).toBe('Need a few more answers from men')
    expect(
      READ_STATUS_COPY.statusLine(
        read({
          status: 'notYetRepresentative',
          underrepresented: ['women', 'age65plus'],
        }),
      ),
    ).toBe('Need a few more answers from women and people 65 and over')
  })

  it('combines both in one sentence', () => {
    expect(
      READ_STATUS_COPY.statusLine(
        read({
          underrepresented: ['unreachedAreas', 'men'],
          unheard: ['unreachedAreas'],
        }),
      ),
    ).toBe(
      'Still need to hear from people in some parts of your district, and a few more answers from men',
    )
  })

  it('joins the parts of the district with another group cleanly', () => {
    expect(
      READ_STATUS_COPY.statusLine(
        read({
          underrepresented: ['unreachedAreas', 'men'],
          unheard: ['unreachedAreas', 'men'],
        }),
      ),
    ).toBe(
      'Still need to hear from people in some parts of your district and men',
    )
  })

  it('names the groups it is still unsure of', () => {
    expect(
      READ_STATUS_COPY.statusLine(
        read({
          status: 'gettingClose',
          underrepresented: ['unreachedAreas', 'age65plus'],
        }),
      ),
    ).toBe(
      'Still unsure what people in a few neighborhoods and people 65 and over think',
    )
  })

  it('labels a read with nobody heard from as waiting to hear back', () => {
    expect(READ_STATUS_COPY.label(read({}))).toBe('Waiting to hear back')
    expect(READ_STATUS_COPY.statusLine(read({}))).toBe('Waiting to hear back')
  })
})
