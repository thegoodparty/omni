import { sortPrototypes } from './prototypeMeta'

const make = (
  slug: string,
  status: 'draft' | 'handoff-ready' | 'shipped',
  createdAt: string,
) => ({
  slug,
  title: slug,
  description: '',
  author: 'a',
  createdAt,
  status,
})

describe('sortPrototypes', () => {
  it('orders newest first by createdAt', () => {
    const out = sortPrototypes([
      make('old', 'draft', '2026-01-01'),
      make('new', 'draft', '2026-06-01'),
    ])
    expect(out.map((p) => p.slug)).toEqual(['new', 'old'])
  })
})
