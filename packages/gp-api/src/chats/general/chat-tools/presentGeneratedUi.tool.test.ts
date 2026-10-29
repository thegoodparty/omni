import { describe, expect, it } from 'vitest'
import { GENERATED_UI_A2UI_CATALOG_ID } from '@goodparty_org/contracts'
import {
  buildPresentGeneratedUiTool,
  GENERATED_UI_RULES,
} from './presentGeneratedUi.tool'

const surface = {
  version: 'v0.9' as const,
  createSurface: { surfaceId: 's', catalogId: GENERATED_UI_A2UI_CATALOG_ID },
}

const withComponents = (components: Record<string, unknown>[]) => ({
  messages: [
    surface,
    {
      version: 'v0.9' as const,
      updateComponents: {
        surfaceId: 's',
        components: components.map((c) => ({
          id: String(c.id),
          component: String(c.component),
          ...c,
        })),
      },
    },
  ],
})

describe('buildPresentGeneratedUiTool', () => {
  const tool = buildPresentGeneratedUiTool()

  it('accepts a payload the catalog renders', () => {
    expect(
      tool.execute(
        withComponents([
          { id: 'root', component: 'Stack', children: ['n'] },
          { id: 'n', component: 'Stat', label: 'Voters', value: '12,480' },
        ]),
      ),
    ).toEqual({ shown: true })
  })

  it('names the component the catalog does not have', () => {
    const result = tool.execute(
      withComponents([{ id: 'root', component: 'Chart' }]),
    )
    expect(result).toMatchObject({
      error: expect.stringContaining("Unknown component type 'Chart'"),
    })
  })

  it('refuses a property the component does not take', () => {
    const result = tool.execute(
      withComponents([{ id: 'root', component: 'Text', body: 'hi' }]),
    )
    expect(result).toMatchObject({ error: expect.stringContaining('Text') })
  })

  it('refuses a child id that no component has', () => {
    const result = tool.execute(
      withComponents([{ id: 'root', component: 'Stack', children: ['gone'] }]),
    )
    expect(result).toHaveProperty('error')
  })
})

describe('GENERATED_UI_RULES', () => {
  it('carries the catalog the SDK generates', () => {
    expect(GENERATED_UI_RULES).toContain('---BEGIN A2UI JSON SCHEMA---')
    expect(GENERATED_UI_RULES).toContain('"ChoiceQuestion"')
  })

  it('shows an example the tool accepts', () => {
    const example =
      GENERATED_UI_RULES.split('- Example input: ')[1]?.split('\n')[0]
    expect(
      buildPresentGeneratedUiTool().execute(JSON.parse(example ?? '{}')),
    ).toEqual({ shown: true })
  })
})
