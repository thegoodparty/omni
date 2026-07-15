import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import type {
  OrdinanceStatusCounts,
  OrdinanceSummary,
} from '@goodparty_org/contracts'
import MyOrdinancesSection from './MyOrdinancesSection'

const base = {
  seedType: 'new' as const,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const inProgress: OrdinanceSummary = {
  ...base,
  id: 'o1',
  slug: 'noise-ordinance',
  status: 'in_progress',
  draftTitle: null,
  goalText: 'Reduce late-night noise',
  lastViewedStep: 'authority',
}

const drafted: OrdinanceSummary = {
  ...base,
  id: 'o2',
  slug: 'sugar-tax',
  status: 'draft',
  draftTitle: 'An Ordinance Levying a Sugar Tax',
  goalText: 'Sugar tax',
  lastViewedStep: 'draft',
}

const counts: OrdinanceStatusCounts = {
  in_progress: 1,
  draft: 1,
  in_review: 0,
  proposed: 0,
  passed: 0,
  repealed: 0,
}

describe('MyOrdinancesSection', () => {
  it('opens a drafted ordinance directly on its draft document page', () => {
    render(<MyOrdinancesSection items={[drafted]} counts={counts} />)
    expect(
      screen.getByRole('link', { name: /An Ordinance Levying a Sugar Tax/ }),
    ).toHaveAttribute('href', '/dashboard/ordinances/draft/sugar-tax')
  })

  it('resumes an in-progress ordinance in the guided flow at its last step', () => {
    render(<MyOrdinancesSection items={[inProgress]} counts={counts} />)
    expect(
      screen.getByRole('link', { name: /Reduce late-night noise/ }),
    ).toHaveAttribute(
      'href',
      '/dashboard/ordinances/solve/noise-ordinance/authority',
    )
  })

  it('still opens the draft document when a drafted title was cleared to empty', () => {
    // Routing keys on status, so clearing the title in the doc editor must not
    // strand the drafted ordinance back in the guided flow.
    render(
      <MyOrdinancesSection
        items={[{ ...drafted, draftTitle: '' }]}
        counts={counts}
      />,
    )
    expect(screen.getByRole('link', { name: /Sugar tax/ })).toHaveAttribute(
      'href',
      '/dashboard/ordinances/draft/sugar-tax',
    )
  })

  it('resumes at clarify when an in-progress ordinance has no recorded step', () => {
    render(
      <MyOrdinancesSection
        items={[{ ...inProgress, lastViewedStep: null }]}
        counts={counts}
      />,
    )
    expect(
      screen.getByRole('link', { name: /Reduce late-night noise/ }),
    ).toHaveAttribute(
      'href',
      '/dashboard/ordinances/solve/noise-ordinance/clarify',
    )
  })
})
