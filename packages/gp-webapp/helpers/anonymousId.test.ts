import { describe, it, expect } from 'vitest'
import { resolveAnonymousId } from './anonymousId'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('resolveAnonymousId', () => {
  // The regression this exists for: on the first load of a build that sets
  // gp_aid, a returning visitor must keep the identity Segment already gave
  // them. Minting here would be written back over `ajs_anonymous_id` by the
  // client and reset every existing anonymous visitor exactly once.
  it('adopts the id Segment already gave a returning visitor', () => {
    expect(resolveAnonymousId('238dca0f-272b-49d0-8ac8-66c14071255d')).toBe(
      '238dca0f-272b-49d0-8ac8-66c14071255d',
    )
  })

  it('mints a new id for a visitor Segment has never seen', () => {
    expect(resolveAnonymousId(undefined)).toMatch(UUID)
  })

  it('mints rather than adopting an empty cookie', () => {
    expect(resolveAnonymousId('')).toMatch(UUID)
    expect(resolveAnonymousId('   ')).toMatch(UUID)
  })

  // analytics-next writes the cookie bare today and the same value JSON-encoded
  // into localStorage. If the cookie ever picks up the quoted form, adopting it
  // verbatim would hand Segment a quoted id that never matches its own.
  it('strips the JSON quoting analytics-next uses elsewhere', () => {
    expect(resolveAnonymousId('"238dca0f-272b-49d0-8ac8-66c14071255d"')).toBe(
      '238dca0f-272b-49d0-8ac8-66c14071255d',
    )
  })

  it('gives two new visitors different ids', () => {
    expect(resolveAnonymousId(undefined)).not.toBe(
      resolveAnonymousId(undefined),
    )
  })
})
