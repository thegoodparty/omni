import dynamic from 'next/dynamic'
import {
  GENERATED_UI_TOOL,
  PresentGeneratedUiA2uiSchema,
} from '@goodparty_org/contracts'
import { defineWidgetTool } from '../widgetRegistry'

// @a2ui/react renders every component inside a custom element defined on
// import, so it cannot load on the server.
const GeneratedUiA2uiSurface = dynamic(
  () => import('./GeneratedUiA2uiSurface'),
  { ssr: false },
)

export type GeneratedUiWidgetContext = {
  onGeneratedUiMessage: (message: string) => void
}

export const generatedUiWidgetTool = defineWidgetTool({
  toolName: GENERATED_UI_TOOL,
  parse: (args) => {
    const parsed = PresentGeneratedUiA2uiSchema.safeParse(args)
    return parsed.success ? parsed.data : null
  },
  render: (payload, { onGeneratedUiMessage }: GeneratedUiWidgetContext) => (
    <GeneratedUiA2uiSurface
      payload={payload}
      onMessage={onGeneratedUiMessage}
    />
  ),
})
