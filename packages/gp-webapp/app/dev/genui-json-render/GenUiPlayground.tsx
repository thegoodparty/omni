'use client'

import { useMemo, useState } from 'react'
import {
  checkGeneratedUiSpec,
  GeneratedUiSpecSchema,
} from '@goodparty_org/contracts'
import { Button, Textarea } from '@styleguide'
import { GeneratedUi } from 'app/dashboard/shared/agent-chat/generated-ui/GeneratedUi'
import { GENUI_FIXTURES } from './fixtures'

const toText = (value: unknown) => JSON.stringify(value, null, 2)

export const GenUiPlayground = () => {
  const [draft, setDraft] = useState(toText(GENUI_FIXTURES[0]?.spec))
  const [events, setEvents] = useState<string[]>([])

  const parsed = useMemo(() => {
    try {
      const result = GeneratedUiSpecSchema.safeParse(JSON.parse(draft))
      if (!result.success) {
        return { issues: result.error.issues.map((issue) => issue.message) }
      }
      return { spec: result.data, issues: checkGeneratedUiSpec(result.data) }
    } catch (error) {
      return { issues: [String(error)] }
    }
  }, [draft])

  const log = (text: string) =>
    setEvents((prev) => [`user turn: ${text}`, ...prev])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">json-render playground</h1>
        <p className="text-sm text-muted-foreground">
          Fixture specs for the Chief of Staff generated UI catalog. Edit the
          JSON to re-render.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {GENUI_FIXTURES.map((fixture) => (
          <Button
            key={fixture.name}
            type="button"
            size="small"
            variant="outline"
            onClick={() => setDraft(toText(fixture.spec))}
          >
            {fixture.name}
          </Button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Textarea
          aria-label="Spec JSON"
          className="min-h-[560px] font-mono text-xs"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-background p-4">
            {parsed.spec ? (
              <GeneratedUi key={draft} spec={parsed.spec} onSendMessage={log} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to render.
              </p>
            )}
          </div>
          {parsed.issues.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-destructive">
              {parsed.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Spec passes the catalog check.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Event log</h2>
            <ul
              data-testid="genui-event-log"
              className="flex flex-col gap-1 text-sm text-muted-foreground"
            >
              {events.length === 0 ? <li>No events yet.</li> : null}
              {events.map((event, i) => (
                <li key={events.length - i}>{event}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
