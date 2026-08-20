'use client'

import { Card, Textarea } from '@styleguide'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import {
  useStoryRewrite,
  type StoryRewriteField,
} from 'app/dashboard/campaign-story/components/useStoryRewrite'
import StoryFieldBar, { type StorySaveState } from './StoryFieldBar'
import { useReportDictationActive } from './useReportDictationActive'

interface StoryIntakeCardProps {
  question: string
  // Optional sub-line under the question. The dashboard page passes it (there is
  // no page-level per-question heading there); onboarding leaves it off since
  // the step chrome already shows the description above the card.
  description?: string
  // Shown as the italic gray placeholder inside the empty field ("e.g. …").
  examplePlaceholder: string
  value: string
  onChange: (value: string) => void
  rewriteField: StoryRewriteField
  analyticsLabel: string
  // Present on the dashboard (per-card Save); omitted in onboarding (deferred).
  save?: StorySaveState
  // Onboarding gates its "Continue" on this so advancing can't snapshot the
  // field before an in-flight transcript lands. Omitted on the dashboard.
  onDictationActiveChange?: (active: boolean) => void
}

// The onboarding story-intake card (Why / Background steps). Deferred-save: it
// never persists — the parent collects the value and saves everything on the
// final step. "Improve with AI" applies in place (no suggestion panel) with an
// Undo, and the mic dictates into the field. Mirrors the Lovable design: bold
// question, borderless textarea with the example as an italic placeholder, a
// char counter, then the shared action bar.
export default function StoryIntakeCard({
  question,
  description,
  examplePlaceholder,
  value,
  onChange,
  rewriteField,
  analyticsLabel,
  save,
  onDictationActiveChange,
}: StoryIntakeCardProps): React.JSX.Element {
  // Pass the raw value (not trimmed): the hook trims internally for the API +
  // empty check, but captures this verbatim as the undo baseline, so trimming
  // here would make Undo silently drop the user's leading/trailing whitespace.
  const rewrite = useStoryRewrite(rewriteField, value, onChange)
  const dictation = useDictationAppend({ analyticsLabel, value, onChange })
  useReportDictationActive(dictation.active, onDictationActiveChange)

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-foreground">{question}</h2>
        {description && (
          <p className="text-base text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="relative">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={examplePlaceholder}
          className="min-h-40 resize-none pb-9 placeholder:italic placeholder:text-muted-foreground"
        />
        <span className="pointer-events-none absolute bottom-2 right-3 text-sm text-muted-foreground">
          {value.length} chars
        </span>
      </div>

      <StoryFieldBar
        rewrite={rewrite}
        dictation={dictation}
        improveDisabled={value.trim().length === 0}
        save={save}
      />
    </Card>
  )
}
