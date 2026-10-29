import {
  GeneratedUiSpecSchema,
  PRESENT_GENERATED_UI_TOOL,
} from '@goodparty_org/contracts'
import { defineWidgetTool } from '../widgetRegistry'
import { GeneratedUi } from './GeneratedUi'

export type GeneratedUiWidgetContext = {
  onClarifyAnswer: (answer: string) => void
}

// The spec is the tool args, so a reloaded turn renders from the persisted
// segment like any card. Sends go through the clarify answer path: an
// ordinary, visible user turn.
export const generatedUiWidgetTool = defineWidgetTool({
  toolName: PRESENT_GENERATED_UI_TOOL,
  parse: (args) => {
    const parsed = GeneratedUiSpecSchema.safeParse(args)
    return parsed.success ? parsed.data : null
  },
  render: (spec, { onClarifyAnswer }: GeneratedUiWidgetContext) => (
    <div className="w-full" data-testid="generated-ui">
      <GeneratedUi spec={spec} onSendMessage={onClarifyAnswer} />
    </div>
  ),
})
