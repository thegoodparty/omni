import { describe, expect, it } from 'vitest'
import { DRAFT_TOOL, isStepWidgetTool, parseStepWidget } from './stepWidgets'

describe('parseStepWidget — present_draft', () => {
  it('parses a valid draft payload into a DRAFT_TOOL instance', () => {
    const widget = parseStepWidget(DRAFT_TOOL, {
      title: 'Draft amendment to Chapter 12',
      description: 'Adds a retention limit.',
      body: 'Section 12.20  Retention.',
    })
    expect(widget?.tool).toBe(DRAFT_TOOL)
    if (widget?.tool !== DRAFT_TOOL) throw new Error('expected draft widget')
    expect(widget.data.title).toBe('Draft amendment to Chapter 12')
  })

  it('drops a draft with an empty body (nothing to render)', () => {
    expect(parseStepWidget(DRAFT_TOOL, { title: 'T', body: '' })).toBeNull()
  })

  it('drops a draft missing its required fields', () => {
    expect(parseStepWidget(DRAFT_TOOL, { title: 'T' })).toBeNull()
    expect(parseStepWidget(DRAFT_TOOL, {})).toBeNull()
  })

  it('recognizes present_draft as a step-widget tool', () => {
    expect(isStepWidgetTool(DRAFT_TOOL)).toBe(true)
    expect(isStepWidgetTool('not_a_widget')).toBe(false)
  })
})
