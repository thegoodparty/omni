import { ArrowLeftIcon, Button } from '@styleguide'
import { SERVE_POLL_READER_COPY } from './pollResultsCopy'

// One theme opened from a ranked list: the way back, the theme, and what
// people said under it. The poll page passes its reply reader; the priority
// results page passes its words-only list and a download.
export const PollThemeDetail = ({
  title,
  summary,
  count,
  onBack,
  action,
  children,
}: {
  title: string
  summary: string | null
  count: string
  onBack: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) => (
  <div className="flex flex-col gap-6">
    <Button
      type="button"
      variant="link"
      className="h-auto w-fit px-0 text-sm text-foreground no-underline hover:underline has-[>svg]:px-0"
      onClick={onBack}
    >
      <ArrowLeftIcon size={16} />
      {SERVE_POLL_READER_COPY.back}
    </Button>
    <header className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm font-semibold text-primary">{count}</p>
      {summary && <p className="text-base text-foreground">{summary}</p>}
      {action && <div className="mt-1">{action}</div>}
    </header>
    {children}
  </div>
)
