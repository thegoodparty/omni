import {
  managedPanelWidgetTools,
  type ManagedPanelWidgetContext,
} from '../../chief-of-staff/components/chat/managedPanelWidgets'
import {
  ordinanceWidgetTools,
  type OrdinanceWidgetContext,
} from '../../ordinances/components/stepWidgets'
import {
  statusMarkerWidgetTool,
  type StatusMarkerWidgetContext,
} from '../../priorities/[priorityId]/components/statusMarkerWidget'
import { cardWidgetTools, type CardWidgetContext } from './cards/cardWidgets'
import {
  presentCardWidgetTools,
  type PresentCardWidgetContext,
} from './cards/presentCardWidgets'
import { clarifyWidgetTool, type ClarifyWidgetContext } from './clarifyWidget'
import {
  composeHandoffWidgetTool,
  type ComposeHandoffWidgetContext,
} from './composeHandoffWidget'
import { createWidgetRegistry } from './widgetRegistry'

// What a surface hands every widget at render time. Surfaces differ only in
// what they fill in; a field a surface leaves out belongs to a tool its agent
// is never offered.
export type ChatWidgetContext = CardWidgetContext &
  ClarifyWidgetContext &
  ComposeHandoffWidgetContext &
  ManagedPanelWidgetContext &
  PresentCardWidgetContext &
  OrdinanceWidgetContext &
  StatusMarkerWidgetContext

// Every tool call that renders as UI in any AI chat, and the only place one
// is registered. AGENTS.md in this folder has the steps to add one.
export const chatWidgets = createWidgetRegistry<ChatWidgetContext>([
  ...presentCardWidgetTools,
  ...cardWidgetTools,
  clarifyWidgetTool,
  composeHandoffWidgetTool,
  ...managedPanelWidgetTools,
  ...ordinanceWidgetTools,
  statusMarkerWidgetTool,
])
