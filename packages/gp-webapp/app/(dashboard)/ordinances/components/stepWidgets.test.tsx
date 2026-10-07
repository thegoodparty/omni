import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import { DRAFT_TOOL, ordinanceWidgets } from './stepWidgets'

const mocks = vi.hoisted(() => ({
  useOrdinanceQualityLoopFlag: vi.fn(),
}))

vi.mock('@shared/experiments/ordinanceQualityLoopFlag', () => ({
  useOrdinanceQualityLoopFlag: mocks.useOrdinanceQualityLoopFlag,
}))

beforeEach(() => {
  mocks.useOrdinanceQualityLoopFlag.mockReturnValue({
    ready: true,
    enabled: false,
  })
})

const resolveDraft = (args: object) =>
  ordinanceWidgets.resolve({ toolName: DRAFT_TOOL }, args)

describe('ordinanceWidgets — present_draft', () => {
  it('parses a valid draft payload into a DRAFT_TOOL instance', () => {
    const widget = resolveDraft({
      title: 'Draft amendment to Chapter 12',
      description: 'Adds a retention limit.',
      body: 'Section 12.20  Retention.',
    })
    expect(widget?.toolName).toBe(DRAFT_TOOL)
    if (!widget) throw new Error('expected draft widget')
    render(<>{widget.render({ slug: 'public-safety-cameras' })}</>)
    expect(screen.getByText('Draft amendment to Chapter 12')).toBeVisible()
  })

  it('drops a draft with an empty body (nothing to render)', () => {
    expect(resolveDraft({ title: 'T', body: '' })).toBeNull()
  })

  it('drops a draft missing its required fields', () => {
    expect(resolveDraft({ title: 'T' })).toBeNull()
    expect(resolveDraft({})).toBeNull()
  })

  it('recognizes present_draft as a step-widget tool', () => {
    expect(ordinanceWidgets.has(DRAFT_TOOL)).toBe(true)
    expect(ordinanceWidgets.has('not_a_widget')).toBe(false)
  })
})
