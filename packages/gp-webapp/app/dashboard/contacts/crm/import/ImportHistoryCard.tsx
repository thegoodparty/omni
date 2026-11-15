import Link from 'next/link'
import { Card, ChevronRightIcon } from '@styleguide'
import type { ContactUpload } from '@goodparty_org/contracts'
import {
  getImportContactsCopy,
  UPLOAD_HISTORY_PATH,
} from './importContactsCopy'

// A section like its neighbours (a heading and one muted line), over one row
// in the universe card's style (DistrictStatCard): the label on the left, the
// count on the right. What needs the user's action is the alerts' job, so the
// row carries no status.
export const ImportHistoryCard = ({
  uploads,
  isWin,
}: {
  uploads: ContactUpload[]
  isWin: boolean
}) => {
  const COPY = getImportContactsCopy(isWin)
  if (uploads.length === 0) return null

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{COPY.historySection.title}</h2>
        <p className="text-sm text-muted-foreground">
          {COPY.historySection.caption}
        </p>
      </div>
      <Card className="w-full gap-0 overflow-hidden rounded-lg py-0">
        <Link
          href={UPLOAD_HISTORY_PATH}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none focus-visible:ring-inset"
        >
          <span className="text-sm">{COPY.history.title}</span>
          <span className="flex shrink-0 items-center gap-2 text-lg font-semibold">
            {uploads.length.toLocaleString()}
            <ChevronRightIcon
              size={16}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
          </span>
        </Link>
      </Card>
    </section>
  )
}
