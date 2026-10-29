import { useEffect, useRef, useState } from 'react'
import {
  MessageProcessor,
  type ActionPayload,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9'
import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react/v0_9'
import {
  GENERATED_UI_SEND_MESSAGE_EVENT,
  type PresentGeneratedUiA2ui,
} from '@goodparty_org/contracts'
import { formatClarifyChoices } from '../ClarifyQuestionWidget'
import { generatedUiA2uiReactCatalog } from './generatedUiA2uiCatalog'

// What the user says when they press something on a generated surface:
// `choices` reads back like a multi-select clarify answer, `text` as written.
export const messageFromA2uiAction = (action: ActionPayload): string | null => {
  if (action.name !== GENERATED_UI_SEND_MESSAGE_EVENT) return null
  const { choices, text } = action.context
  if (Array.isArray(choices)) {
    const labels = choices.filter(
      (choice): choice is string =>
        typeof choice === 'string' && choice.length > 0,
    )
    return labels.length > 0 ? formatClarifyChoices(labels) : null
  }
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

export type GeneratedUiA2uiSurfaceProps = {
  payload: PresentGeneratedUiA2ui
  onMessage: (message: string) => void
  onAction?: (action: ActionPayload) => void
  onError?: (message: string) => void
}

export default function GeneratedUiA2uiSurface({
  payload,
  onMessage,
  onAction,
  onError,
}: GeneratedUiA2uiSurfaceProps) {
  const [surfaces, setSurfaces] = useState<
    SurfaceModel<ReactCatalogComponent>[]
  >([])
  const [failed, setFailed] = useState(false)
  const handlers = useRef({ onMessage, onAction, onError })
  handlers.current = { onMessage, onAction, onError }
  // A transcript re-parses its turns on every render, so the payload is a new
  // object each time. Keyed on its content, a surface keeps its data model
  // (a half-picked question) until the payload itself changes.
  const payloadKey = JSON.stringify(payload)
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  useEffect(() => {
    const processor = new MessageProcessor<ReactCatalogComponent>(
      [generatedUiA2uiReactCatalog],
      (action) => {
        handlers.current.onAction?.(action)
        const message = messageFromA2uiAction(action)
        if (message) handlers.current.onMessage(message)
      },
    )
    const errorSub = processor.onSurfaceCreated((surface) => {
      surface.onError.subscribe((error) => {
        handlers.current.onError?.(`${error.code}: ${error.message}`)
      })
    })
    try {
      processor.processMessages(payloadRef.current.messages)
      setSurfaces(Array.from(processor.model.surfacesMap.values()))
      setFailed(false)
    } catch (err) {
      setFailed(true)
      handlers.current.onError?.(
        err instanceof Error ? err.message : String(err),
      )
    }
    return () => {
      errorSub.unsubscribe()
      processor.dispose()
    }
  }, [payloadKey])

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        This card could not be shown.
      </p>
    )
  }
  return (
    <div className="flex w-full flex-col gap-4">
      {surfaces.map((surface) => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </div>
  )
}
