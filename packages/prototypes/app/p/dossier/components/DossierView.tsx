'use client'

import { Button } from '@goodparty_org/styleguide'
import { ArrowLeft, Check } from 'lucide-react'
import {
  PRIORITY,
  SECTION_STATE_CLASS,
  SECTION_STATE_LABEL,
  type Section,
} from '../data'

type DossierViewProps = {
  sections: Section[]
  settledCount: number
  busy: boolean
  onMarkSettled: (id: string) => void
  onBackToChat: () => void
}

const EMPTY_HINT: Record<string, string> = {
  options: 'Comes from the problem and the evidence, once those hold up.',
  authority:
    'Comes from your attorney. This is the one blocking everything else.',
  method: 'Comes from the option you pick and what your authority allows.',
  plan: 'Comes from the method, once that is picked.',
}

export const DossierView = ({
  sections,
  settledCount,
  busy,
  onMarkSettled,
  onBackToChat,
}: DossierViewProps) => (
  <div className="pb-32">
    <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="small"
          icon={<ArrowLeft />}
          onClick={onBackToChat}
        >
          Back to chat
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">
          {PRIORITY.title}
        </h1>
        <span className="hidden shrink-0 text-sm text-muted-foreground sm:block">
          {settledCount} of {sections.length} settled
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{PRIORITY.office}</span>
        <span>&middot;</span>
        <span>{PRIORITY.source}</span>
        <span>&middot;</span>
        <span>{PRIORITY.visibility}</span>
        <span>&middot;</span>
        <span>Opened {PRIORITY.opened}</span>
      </div>
    </div>

    <div className="mx-auto max-w-2xl px-4 pt-6 sm:px-0">
      <div className="divide-y divide-border">
        {sections.map((section) => (
          <div key={section.id} className="py-6 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">
                {section.label}
              </h2>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${SECTION_STATE_CLASS[section.state]}`}
              >
                {SECTION_STATE_LABEL[section.state]}
              </span>
            </div>

            {section.state === 'empty' ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm italic text-muted-foreground">
                  Nothing here yet.
                </p>
                {EMPTY_HINT[section.id] ? (
                  <p className="text-sm text-muted-foreground">
                    {EMPTY_HINT[section.id]}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground">
                {section.body}
              </p>
            )}

            {/* A settled section keeps its caveat on the record, but stops
                flagging it: you decided it was good enough. */}
            {section.caveat ? (
              section.state === 'settled' ? (
                <p className="text-muted-foreground mt-2 text-sm">
                  <span className="font-medium">Known gap:</span>{' '}
                  {section.caveat}
                </p>
              ) : (
                <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
                  <span className="font-medium">Still thin:</span>{' '}
                  {section.caveat}
                </div>
              )
            ) : null}

            {section.source ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {section.source}
              </p>
            ) : null}

            {section.state === 'settled' ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-success">
                <Check className="size-4" />
                Settled
              </p>
            ) : null}

            {section.state === 'working' || section.state === 'thin' ? (
              <Button
                variant="outline"
                size="small"
                icon={<Check />}
                disabled={busy}
                onClick={() => onMarkSettled(section.id)}
                className="mt-3"
              >
                Mark settled
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Everything here came out of one conversation. Changing it here changes
        it there.
      </p>
    </div>
  </div>
)
