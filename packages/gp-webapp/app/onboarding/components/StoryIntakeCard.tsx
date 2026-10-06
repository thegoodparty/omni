'use client'

import { Card, Textarea, cn } from '@styleguide'
import { useDictationAppend } from 'app/(dashboard)/shared/dictation/useDictationAppend'
import {
  useStoryRewrite,
  type StoryRewriteField,
} from 'app/(dashboard)/campaign-story/components/useStoryRewrite'
import StoryFieldBar, { type StorySaveState } from './StoryFieldBar'
import { useReportDictationActive } from './useReportDictationActive'

interface StoryIntakeCardProps {
  question: string
  // 'step' (default) is onboarding's: the question leads the card. 'section'
  // (Your story) sets the question above the card, as the
  // outreach compose steps do. Either way the field is built like the
  // outreach compose cards: seamless in the card, over the action footer.
  variant?: 'step' | 'section'
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
  variant = 'step',
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
  const isSection = variant === 'section'

  const heading = (
    <h2
      className={cn(
        'text-foreground',
        isSection ? 'text-xl font-semibold' : 'text-2xl font-bold',
      )}
    >
      {question}
    </h2>
  )
  const field = (
    <>
      <Textarea
        variant="seamless"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={examplePlaceholder}
        className="min-h-[140px] resize-none placeholder:text-muted-foreground"
      />

      <StoryFieldBar
        rewrite={rewrite}
        dictation={dictation}
        improveDisabled={value.trim().length === 0}
        save={save}
      />
    </>
  )

  // A section is laid out like an outreach compose step: the question
  // above, and a card that holds only the field and its
  // footer. A step keeps the question in the card, under the step's own title.
  if (isSection) {
    return (
      <section className="flex flex-col gap-3">
        {heading}
        <Card className="flex flex-col gap-3 p-4">{field}</Card>
      </section>
    )
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      {heading}
      {field}
    </Card>
  )
}
