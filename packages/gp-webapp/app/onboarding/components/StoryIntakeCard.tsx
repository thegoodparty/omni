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
  // 'step' (default) is onboarding's: the question leads the step, over a
  // boxed field. 'section' sits under a page title (Your story): a smaller
  // question, a rule under the heading, and the field as the card's own body.
  variant?: 'step' | 'section'
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
  variant = 'step',
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
  const isSection = variant === 'section'

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div
        className={cn(
          'flex flex-col gap-1',
          isSection && '-mx-6 border-b border-border px-6 pb-4',
        )}
      >
        <h2
          className={cn(
            'text-foreground',
            isSection ? 'text-lg font-semibold' : 'text-2xl font-bold',
          )}
        >
          {question}
        </h2>
        {description && (
          <p className="text-base text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="relative">
        <Textarea
          variant={isSection ? 'seamless' : 'default'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={examplePlaceholder}
          className={cn(
            'min-h-40 resize-none placeholder:italic placeholder:text-muted-foreground',
            isSection ? 'pb-7' : 'pb-9',
          )}
        />
        <span
          className={cn(
            'pointer-events-none absolute text-sm text-muted-foreground',
            isSection ? 'bottom-0 right-0' : 'bottom-2 right-3',
          )}
        >
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
