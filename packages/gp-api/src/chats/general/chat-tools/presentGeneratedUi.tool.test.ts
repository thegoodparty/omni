import { describe, expect, it } from 'vitest'
import { buildPresentGeneratedUiTool } from './presentGeneratedUi.tool'

describe('buildPresentGeneratedUiTool', () => {
  const tool = buildPresentGeneratedUiTool()

  it('acks a spec that binds a question to state and submits it', async () => {
    const spec = tool.inputSchema.parse({
      root: 'main',
      elements: {
        main: { type: 'Stack', props: {}, children: ['question'] },
        question: {
          type: 'ChoiceQuestion',
          props: {
            question: 'Which channels?',
            options: ['Text', 'Door'],
            multi: true,
            value: { $bindState: '/answers/channels' },
          },
          children: [],
          on: {
            submit: {
              action: 'submit_choices',
              params: { choices: { $state: '/answers/channels' } },
            },
          },
        },
      },
      state: { answers: { channels: [] } },
    })
    expect(tool.inputSchema.parse(spec).elements.question?.on).toBeDefined()
    expect(await tool.execute(spec)).toEqual({ shown: true })
  })

  it('returns every problem the catalog finds as an error', async () => {
    const spec = tool.inputSchema.parse({
      root: 'main',
      elements: {
        main: { type: 'Stack', props: {}, children: ['stat', 'ghost'] },
        stat: {
          type: 'Stat',
          props: { label: 'Turnout' },
          children: [],
          on: { press: { action: 'launch_rocket' } },
        },
        chart: { type: 'PieChart', props: {}, children: [] },
      },
    })
    const result = (await tool.execute(spec)) as { error: string }
    expect(result.error).toContain('"ghost"')
    expect(result.error).toContain('elements.stat.props.value')
    expect(result.error).toContain('unknown action "launch_rocket"')
    expect(result.error).toContain('elements.chart.type')
  })
})
