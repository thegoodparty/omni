import { describe, expect, it } from 'vitest'
import {
  buildPresentGeneratedUiTool,
  OPEN_UI_PROMPT_BLOCK,
} from './presentGeneratedUi.tool'

describe('buildPresentGeneratedUiTool', () => {
  const tool = buildPresentGeneratedUiTool()

  it('acks a program that renders against the catalog', async () => {
    const program = [
      'root = Stack([title, stats])',
      'title = Heading("At a glance")',
      'stats = Stack([s1], "horizontal")',
      's1 = Stat("Residents", 48200)',
    ].join('\n')
    expect(await tool.execute({ program })).toEqual({
      shown: true,
      dropped: [],
    })
  })

  it('refuses a program with an unknown component or a missing field', async () => {
    const program = [
      'root = Stack([title, card])',
      'title = Heading()',
      'card = Card("Not in the catalog")',
    ].join('\n')
    const result = (await tool.execute({ program })) as { error: string }
    expect(result.error).toContain('title: missing required field "/text"')
    expect(result.error).toContain('Unknown component "Card"')
  })

  it('refuses a reference that is never defined', async () => {
    const result = (await tool.execute({
      program: 'root = Stack([missing])',
    })) as { error: string }
    expect(result.error).toContain('missing is referenced but never defined')
  })
})

describe('OPEN_UI_PROMPT_BLOCK', () => {
  it('lists every catalog component and the custom action from the library', () => {
    for (const signature of [
      'Stack(children:',
      'Stat(label: string, value: string | number',
      'ContactCard(name: string',
      'MapCard(title: string',
      'OutreachCard(channel: "text" | "call" | "door" | "social"',
      'ChoiceQuestion(question: string, options: string[], multi?: boolean)',
      'ActionButton(label: string, action: ActionExpression)',
      '@StartOutreach(channel:',
    ]) {
      expect(OPEN_UI_PROMPT_BLOCK).toContain(signature)
    }
    expect(OPEN_UI_PROMPT_BLOCK).not.toContain(
      'Your ENTIRE response must be valid openui-lang',
    )
  })
})
