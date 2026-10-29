import {
  PRESENT_GENERATED_UI_TOOL,
  PresentGeneratedUiSchema,
} from '@goodparty_org/contracts'
import { defineWidgetTool } from '../widgetRegistry'
import { OpenUiProgram } from './OpenUiProgram'

export type GeneratedUiWidgetContext = {
  onGeneratedUiMessage: (content: string) => void
}

export const generatedUiWidgetTool = defineWidgetTool({
  toolName: PRESENT_GENERATED_UI_TOOL,
  parse: (args) => {
    const parsed = PresentGeneratedUiSchema.safeParse(args)
    return parsed.success ? parsed.data : null
  },
  render: ({ program }, { onGeneratedUiMessage }: GeneratedUiWidgetContext) => (
    <OpenUiProgram program={program} onMessage={onGeneratedUiMessage} />
  ),
})
