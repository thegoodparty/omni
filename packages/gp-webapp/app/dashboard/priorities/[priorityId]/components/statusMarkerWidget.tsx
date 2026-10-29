import {
  defineWidgetTool,
  type WidgetToolCall,
} from '../../../shared/agent-chat/widgetRegistry'
import { STATUS_TOOL, type StepChange } from '../data/statusUpdates'
import { StatusChangeMarker } from './StatusChangeMarker'

export type StatusMarkerWidgetContext = {
  // What the rail went through at this call. That lives in the surface's
  // status replay, not in the tool args: a stored patch says what a step
  // became but not what it was.
  statusChanges?: (call: WidgetToolCall) => StepChange[] | undefined
}

export const statusMarkerWidgetTool = defineWidgetTool({
  toolName: STATUS_TOOL,
  parse: () => ({}),
  render: (_data, { statusChanges }: StatusMarkerWidgetContext, call) => {
    const changes = statusChanges?.(call)
    return changes ? <StatusChangeMarker changes={changes} /> : null
  },
})
