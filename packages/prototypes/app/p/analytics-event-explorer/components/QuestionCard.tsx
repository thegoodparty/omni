'use client'

import {
  CircleSlash,
  ExternalLink,
  TriangleAlert,
  Check,
  X,
  ListFilter,
} from 'lucide-react'
import { Badge, Button, Card, CardContent } from '@goodparty_org/styleguide'
import { deslug, type Question } from '../lib/data'
import { coverageCopy, TONE_CLASS } from '../lib/verdict'

const SURFACE_ICON = {
  live: <Check className="h-4 w-4 text-success-dark" />,
  dead: <X className="h-4 w-4 text-error-dark" />,
  gap: <CircleSlash className="h-4 w-4 text-muted-foreground" />,
}

const SURFACE_NOTE = {
  live: '',
  dead: 'its event stopped working',
  gap: 'no event here',
}

type Props = {
  question: Question
  selected?: boolean
  onSelect?: () => void
}

export const QuestionCard = ({
  question: q,
  selected = false,
  onSelect,
}: Props) => {
  const c = coverageCopy(q.coverage)

  return (
    <Card className={selected ? 'border-foreground' : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="max-w-2xl font-medium">{q.question}</h3>
          <Badge className={TONE_CLASS[c.tone]}>{c.label}</Badge>
        </div>

        <p className="text-sm text-muted-foreground">{c.blurb}</p>

        {q.answer_url && (
          <a
            className="inline-flex items-center gap-1 text-sm text-foreground underline"
            href={q.answer_url}
            target="_blank"
            rel="noreferrer"
          >
            Answered by {q.answer_label || 'this'}{' '}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {(q.headline || q.caveats) && (
          <div className="flex gap-2 rounded-md border border-warning bg-warning-background p-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-dark" />
            <div className="min-w-0">
              <div className="font-medium">Read this before you count it</div>
              <p className="mt-1 whitespace-pre-line">
                {q.headline || q.caveats}
              </p>
              {q.headline && q.caveats && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    The detail, for whoever writes the query
                  </summary>
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                    {q.caveats}
                  </p>
                </details>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Where this happens
          </div>
          {q.surfaces.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {SURFACE_ICON[s.state]}
              <span className="min-w-0">
                {deslug(s.label)}
                {s.instrumented_by ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {s.instrumented_by}
                  </span>
                ) : null}
                {SURFACE_NOTE[s.state] && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {SURFACE_NOTE[s.state]}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {onSelect && (
          <Button
            size="small"
            variant={selected ? 'default' : 'outline'}
            onClick={onSelect}
          >
            <ListFilter className="mr-1 h-3 w-3" />
            {selected
              ? 'Showing its events below'
              : 'Show the events answering this'}
          </Button>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {q.asked_by && <span>Asked by {q.asked_by}</span>}
          {q.product && <span>{q.product}</span>}
          {q.okr && <span>OKR: {q.okr}</span>}
          {q.clickup_task && (
            <a
              className="inline-flex items-center gap-1 hover:text-foreground"
              href={`https://app.clickup.com/t/${q.clickup_task}`}
              target="_blank"
              rel="noreferrer"
            >
              Ticket <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
