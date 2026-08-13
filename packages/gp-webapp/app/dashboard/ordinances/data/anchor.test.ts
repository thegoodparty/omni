import { describe, expect, it } from 'vitest'
import { ChatAnchorSchema, type Ordinance } from '@goodparty_org/contracts'
import { buildOrdinanceAnchor } from './anchor'

const ordinance = (overrides: Partial<Ordinance> = {}): Ordinance =>
  ({ id: 'ord-1', draftTitle: null, goalText: null, ...overrides }) as Ordinance

const opts = {
  url: '/dashboard/ordinances/solve/s/clarify',
  step: 'clarify' as const,
}

describe('buildOrdinanceAnchor', () => {
  it('clamps a long goal to the schema limits so the anchor stays valid', () => {
    // A "complex idea" longer than the title cap used to overflow the anchor
    // and get createConversation rejected — the false "couldn't open" error.
    const anchor = buildOrdinanceAnchor(
      ordinance({ goalText: 'x'.repeat(600) }),
      opts,
    )
    expect(anchor.snapshot.title).toHaveLength(500)
    expect(ChatAnchorSchema.safeParse(anchor).success).toBe(true)
  })

  it('clamps a very long goal for the summary field too', () => {
    const anchor = buildOrdinanceAnchor(
      ordinance({ goalText: 'y'.repeat(6000) }),
      opts,
    )
    expect(anchor.snapshot.summary).toHaveLength(5000)
    expect(ChatAnchorSchema.safeParse(anchor).success).toBe(true)
  })

  it('prefers a saved draft title over the goal', () => {
    const anchor = buildOrdinanceAnchor(
      ordinance({
        draftTitle: 'Camera retention amendment',
        goalText: 'x'.repeat(600),
      }),
      opts,
    )
    expect(anchor.snapshot.title).toBe('Camera retention amendment')
  })

  it('falls back to a placeholder title when nothing is set', () => {
    expect(buildOrdinanceAnchor(ordinance(), opts).snapshot.title).toBe(
      'Untitled ordinance',
    )
  })
})
