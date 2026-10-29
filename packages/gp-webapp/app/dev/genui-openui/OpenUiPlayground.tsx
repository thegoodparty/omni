'use client'

import { useState } from 'react'
import { Button, cn, Textarea } from '@styleguide'
import { OpenUiProgram } from 'app/dashboard/shared/agent-chat/openui/OpenUiProgram'
import { OPEN_UI_FIXTURES } from './fixtures'

const OpenUiPlayground = () => {
  const [fixtureName, setFixtureName] = useState(OPEN_UI_FIXTURES[0]?.name)
  const [program, setProgram] = useState(OPEN_UI_FIXTURES[0]?.program ?? '')
  const [log, setLog] = useState<string[]>([])
  const append = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">OpenUI playground</h1>
        <p className="text-sm text-muted-foreground">
          The present_generated_ui catalog rendered by @openuidev/react-lang.
          Edit a program to re-render it; actions land in the log.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {OPEN_UI_FIXTURES.map((fixture) => (
          <Button
            key={fixture.name}
            type="button"
            size="small"
            variant={fixture.name === fixtureName ? 'default' : 'outline'}
            onClick={() => {
              setFixtureName(fixture.name)
              setProgram(fixture.program)
            }}
          >
            {fixture.name}
          </Button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Textarea
          aria-label="OpenUI program"
          value={program}
          onChange={(event) => {
            setFixtureName(undefined)
            setProgram(event.target.value)
          }}
          className="min-h-96 font-mono text-xs"
        />
        <div
          className="rounded-xl border border-border bg-background p-4"
          data-testid="openui-playground-output"
        >
          <OpenUiProgram
            key={fixtureName ?? 'edited'}
            program={program}
            onMessage={(content) => append(`user turn: ${content}`)}
            onAction={(event) =>
              append(`action ${event.type}: ${JSON.stringify(event.params)}`)
            }
            onError={(errors) =>
              errors.forEach((error) =>
                append(`error ${error.code}: ${error.message}`),
              )
            }
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Event log</h2>
        <pre
          className={cn(
            'min-h-24 whitespace-pre-wrap rounded-xl border border-border bg-muted p-3 text-xs',
            log.length === 0 && 'text-muted-foreground',
          )}
          data-testid="openui-playground-log"
        >
          {log.length > 0 ? log.join('\n') : 'No events yet.'}
        </pre>
      </div>
    </div>
  )
}

export default OpenUiPlayground
