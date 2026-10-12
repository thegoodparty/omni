import Link from 'next/link'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { ArrowLeftIcon } from '@styleguide'
import { whatWeHeardCopy } from '../../../../copy'

const ThemeTitle = ({
  theme,
  outreachId,
  isServe,
}: {
  theme: FeedbackThemeDetail
  outreachId: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Link
          href={`/dashboard/issue-capture/${outreachId}`}
          aria-label={copy.back}
          className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <ArrowLeftIcon size={20} />
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">
          {theme.title}
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {copy.conversations(theme.conversationCount)}
      </p>
      <p className="text-base text-foreground">{theme.summary}</p>
    </div>
  )
}

export default ThemeTitle
