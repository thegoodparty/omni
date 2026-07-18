import Link from 'next/link'
import { Badge, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type { OrdinancePresentDraft } from '@goodparty_org/contracts'
import { useOrdinanceQualityLoopFlag } from '@shared/experiments/ordinanceQualityLoopFlag'

// The present_draft tool payload rendered as a compact "draft ready" card. The
// full ordinance text lives on the record (draft columns) and opens on its own
// document page; the chat only surfaces this pointer + a one-line summary, so
// the transcript stays readable and the draft is edited as a document.
export default function DraftReadyWidget({
  draft,
  slug,
}: {
  draft: OrdinancePresentDraft
  slug: string
}): React.JSX.Element {
  const { title, description } = draft
  // Expectation-setting only, not the treatment surface — read without
  // exposure. saveDraft auto-starts the improvement loop for flagged-in
  // users, so the card says what will already be happening on the draft page.
  const { enabled: loopEnabled } = useOrdinanceQualityLoopFlag(false)
  return (
    <Link
      href={`/dashboard/ordinances/draft/${slug}`}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold leading-6 text-foreground">
            {title}
          </p>
          {description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
          {loopEnabled ? (
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;re running quality checks on it now — you can watch or
              stop them from the draft page.
            </p>
          ) : null}
        </div>
        <Badge
          variant="outline"
          shape="pill"
          className={cn(
            'shrink-0 text-xs font-semibold uppercase tracking-wide',
            'border-warning/50 bg-warning/10 text-warning',
          )}
        >
          Draft for attorney
        </Badge>
      </div>
      <span className="flex items-center gap-1 self-end text-sm font-medium text-primary">
        Open draft
        <ChevronRightIcon
          className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  )
}
