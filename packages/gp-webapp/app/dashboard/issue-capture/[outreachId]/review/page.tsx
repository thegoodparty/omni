import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import Link from 'next/link'
import { ArrowLeftIcon, Button } from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import { issueCaptureAccess } from '../../issueCaptureAccess'
import { whatWeHeardCopy } from '../../copy'
import PendingMemoList from './components/PendingMemoList'

export const metadata = pageMetaData({
  title: 'Notes to review | GoodParty.org',
  description: 'Notes to review',
  slug: '/dashboard/issue-capture',
})

export const dynamic = 'force-dynamic'

// Reached from the report's "waiting for review" and the turf's "Notes to
// review", never from the nav.
export default async function Page({
  params,
}: {
  params: Promise<{ outreachId: string }>
}): Promise<React.JSX.Element> {
  const { isServe } = await issueCaptureAccess()
  const outreachId = parsePositiveListId((await params).outreachId)
  if (outreachId === undefined) notFound()

  const copy = whatWeHeardCopy(isServe)

  return (
    <DashboardLayout
      pathname={
        isServe ? '/dashboard/constituent-outreach' : '/dashboard/outreach'
      }
      showAlert={false}
      navHeader={{ label: copy.reviewTitle }}
    >
      {/* The report's own top bar and way back, the same as What we heard's
          and the theme page's, so the notes float on the gray canvas. */}
      <div className="-mx-2 -mt-2 flex h-14 shrink-0 items-center border-b border-border bg-background px-4 md:-mx-4 md:-mt-4 md:px-6">
        <Button asChild variant="ghost" size="small" className="gap-1 px-2">
          {/* Reads "Back", and names the report it returns to for a screen
              reader. */}
          <Link
            href={`/dashboard/issue-capture/${outreachId}`}
            aria-label={copy.back}
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            {copy.backLabel}
          </Link>
        </Button>
      </div>
      {/* The report's content column, inset 16px from the edge on a phone,
          the same as the bar above. */}
      <div className="mx-auto mt-8 flex w-full max-w-[560px] flex-col gap-6 px-2 pb-8 md:px-0">
        <PendingMemoList
          outreachId={outreachId}
          isServe={isServe}
          titled={false}
        />
      </div>
    </DashboardLayout>
  )
}
