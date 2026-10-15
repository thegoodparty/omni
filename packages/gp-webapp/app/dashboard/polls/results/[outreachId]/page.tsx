import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import { PollResultsPage } from 'app/dashboard/outreach/v2/poll/results/PollResultsPage'
import serveAccess from '../../../shared/serveAccess'

export const metadata = pageMetaData({
  title: 'Poll results | GoodParty.org',
  description: 'Poll results',
  slug: '/dashboard/polls/results',
})

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ outreachId: string }>
}): Promise<React.JSX.Element> {
  await serveAccess()
  const outreachId = parsePositiveListId((await params).outreachId)
  if (outreachId === undefined) notFound()

  return <PollResultsPage outreachId={outreachId} />
}
