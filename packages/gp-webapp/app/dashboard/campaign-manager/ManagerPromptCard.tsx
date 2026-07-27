'use client'

import { Button, Card } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import { MoreMenu } from 'app/shared/utils/MoreMenu'

interface ManagerPromptCardProps {
  title: string
  description: string
  ctaLabel: string
  onCta: () => void
  // Fired by the "Skip" item in the card's overflow (⋮) menu. Callers persist
  // the dismissal so the card stays hidden.
  onSkip: () => void
}

// The first-run Campaign Manager prompt cards (meet the manager, personalize
// the campaign). A distinct look from the weekly tracker's TaskCard: a blue
// "Campaign Manager" eyebrow, an overflow menu to skip, and a right-aligned
// CTA. Kept separate so the shared TaskCard (tracker + archive) is unaffected.
export default function ManagerPromptCard({
  title,
  description,
  ctaLabel,
  onCta,
  onSkip,
}: ManagerPromptCardProps): React.JSX.Element {
  return (
    <Card className="gap-3 rounded-2xl border border-grayscale-300 p-5 shadow-sm lg:p-6">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
          <SparklesIcon className="size-3.5" aria-hidden />
          Campaign Manager
        </span>
        <MoreMenu menuItems={[{ label: 'Skip', onClick: onSkip }]} />
      </div>

      <h2 className="text-xl font-semibold text-card-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>

      <div className="flex justify-end pt-2">
        <Button type="button" className="rounded-full" onClick={onCta}>
          {ctaLabel}
        </Button>
      </div>
    </Card>
  )
}
