import { ArrowLeftIcon, Button } from '@styleguide'
import { PollCommentList } from './PollCommentList'
import { SERVE_POLL_READER_COPY } from './pollResultsCopy'
import type { ReplyScope } from './queries'

export const PollThemeDetail = ({
  outreachId,
  scope,
  title,
  summary,
  count,
  onBack,
}: {
  outreachId: number
  scope: ReplyScope
  title: string
  summary: string | null
  count: string
  onBack: () => void
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
    </header>
    <PollCommentList outreachId={outreachId} scope={scope} />
  </div>
)
