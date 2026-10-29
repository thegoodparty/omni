'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { ActionPayload } from '@a2ui/web_core/v0_9'
import {
  PresentGeneratedUiA2uiSchema,
  type PresentGeneratedUiA2ui,
} from '@goodparty_org/contracts'
import { Button, cn, Textarea } from '@styleguide'
import { GENUI_A2UI_FIXTURES } from './fixtures'

const GeneratedUiA2uiSurface = dynamic(
  () =>
    import('../../dashboard/shared/agent-chat/generatedUi/GeneratedUiA2uiSurface'),
  { ssr: false },
)

type LogEntry = {
  at: string
  kind: 'message' | 'action' | 'error'
  text: string
}

const stringify = (payload: PresentGeneratedUiA2ui) =>
  JSON.stringify(payload, null, 2)

export default function GenUiA2uiPlayground() {
  const first = GENUI_A2UI_FIXTURES[0]!
  const [selected, setSelected] = useState(first.name)
  const [source, setSource] = useState(stringify(first.payload))
  const [payload, setPayload] = useState<PresentGeneratedUiA2ui | null>(
    first.payload,
  )
  const [parseError, setParseError] = useState<string | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])

  const append = (kind: LogEntry['kind'], text: string) =>
    setLog((entries) => [
      { at: new Date().toLocaleTimeString(), kind, text },
      ...entries,
    ])

  const render = (text: string) => {
    setSource(text)
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
      return
    }
    const parsed = PresentGeneratedUiA2uiSchema.safeParse(json)
    if (!parsed.success) {
      setParseError(parsed.error.issues[0]?.message ?? 'Not an A2UI payload')
      return
    }
    setParseError(null)
    setPayload(parsed.data)
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          Generated UI playground: A2UI
        </h1>
        <p className="text-sm text-muted-foreground">
          A2UI v0.9 payloads, as the Chief of Staff&apos;s present_generated_ui
          tool sends them, rendered with our catalog.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        {GENUI_A2UI_FIXTURES.map((fixture) => (
          <Button
            key={fixture.name}
            type="button"
            size="small"
            variant={fixture.name === selected ? 'default' : 'outline'}
            onClick={() => {
              setSelected(fixture.name)
              render(stringify(fixture.payload))
            }}
          >
            {fixture.name}
          </Button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <label htmlFor="genui-a2ui-source" className="text-sm font-medium">
            Payload
          </label>
          <Textarea
            id="genui-a2ui-source"
            className="min-h-[480px] font-mono text-xs"
            value={source}
            onChange={(event) => render(event.target.value)}
          />
          {parseError ? (
            <p className="text-sm text-destructive">{parseError}</p>
          ) : null}
        </section>
        <section className="flex flex-col gap-4">
          <span className="text-sm font-medium">Rendered</span>
          <div
            className="rounded-xl border border-dashed border-border p-4"
            data-testid="genui-a2ui-rendered"
          >
            {payload ? (
              <GeneratedUiA2uiSurface
                payload={payload}
                onMessage={(message) => append('message', message)}
                onAction={(action: ActionPayload) =>
                  append(
                    'action',
                    `${action.name} from ${action.sourceComponentId} ${JSON.stringify(action.context)}`,
                  )
                }
                onError={(message) => append('error', message)}
              />
            ) : null}
          </div>
          <span className="text-sm font-medium">Event log</span>
          <ol
            className="flex max-h-64 flex-col gap-1 overflow-auto rounded-xl border border-border p-3 font-mono text-xs"
            data-testid="genui-a2ui-log"
          >
            {log.length === 0 ? (
              <li className="text-muted-foreground">No events yet.</li>
            ) : (
              log.map((entry, i) => (
                <li
                  key={`${entry.at}-${i}`}
                  className={cn(entry.kind === 'error' && 'text-destructive')}
                >
                  {entry.at} [{entry.kind}] {entry.text}
                </li>
              ))
            )}
          </ol>
        </section>
      </div>
    </main>
  )
}
