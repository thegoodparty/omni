'use client'

import { Card, Textarea } from '@styleguide'
import { useDictationAppend } from 'app/dashboard/briefings/shared/useDictationAppend'
import {
  useStoryRewrite,
  type StoryRewriteField,
} from 'app/dashboard/campaign-story/components/useStoryRewrite'
import StoryFieldBar, { type StorySaveState } from './StoryFieldBar'

interface StoryIntakeCardProps {
  question: string
  // Shown as the italic gray placeholder inside the empty field ("e.g. …").
  examplePlaceholder: string
  value: string
  onChange: (value: string) => void
  rewriteField: StoryRewriteField
  analyticsLabel: string
  // Present on the dashboard (per-card Save); omitted in onboarding (deferred).
  save?: StorySaveState
}

// The onboarding story-intake card (Why / Background steps). Deferred-save: it
// never persists — the parent collects the value and saves everything on the
// final step. "Improve with AI" applies in place (no suggestion panel) with an
// Undo, and the mic dictates into the field. Mirrors the Lovable design: bold
// question, borderless textarea with the example as an italic placeholder, a
// char counter, then the shared action bar.
export default function StoryIntakeCard({
  question,
  examplePlaceholder,
  value,
  onChange,
  rewriteField,
  analyticsLabel,
  save,
}: StoryIntakeCardProps): React.JSX.Element {
  const rewrite = useStoryRewrite(rewriteField, value.trim(), onChange)
  const dictation = useDictationAppend({ analyticsLabel, value, onChange })

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-2xl font-bold text-foreground">{question}</h2>

      <div className="flex flex-col gap-2">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={examplePlaceholder}
          className="min-h-40 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 placeholder:italic placeholder:text-muted-foreground"
        />
        <span className="self-end text-sm text-muted-foreground">
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
