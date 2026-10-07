import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import { issueCaptureAccess } from '../issueCaptureAccess'
import WhatWeHeardPage from './components/WhatWeHeardPage'

export const metadata = pageMetaData({
  title: 'What we heard | GoodParty.org',
  description: 'What we heard',
  slug: '/dashboard/issue-capture',
})

export const dynamic = 'force-dynamic'

// Reached from the turf and the phone list it reports on, never from the nav.
export default async function Page({
  params,
}: {
  params: Promise<{ outreachId: string }>
}): Promise<React.JSX.Element> {
  const { isServe } = await issueCaptureAccess()
  const outreachId = parsePositiveListId((await params).outreachId)
  if (outreachId === undefined) notFound()

  return <WhatWeHeardPage outreachId={outreachId} isServe={isServe} />
}
