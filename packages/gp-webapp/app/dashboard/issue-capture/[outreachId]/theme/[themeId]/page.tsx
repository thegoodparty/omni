import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import { issueCaptureAccess } from '../../../issueCaptureAccess'
import ThemeDetailPage from './components/ThemeDetailPage'

export const metadata = pageMetaData({
  title: 'What we heard | GoodParty.org',
  description: 'What we heard',
  slug: '/dashboard/issue-capture',
})

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ outreachId: string; themeId: string }>
}): Promise<React.JSX.Element> {
  const { isServe } = await issueCaptureAccess()
  const { outreachId: rawOutreachId, themeId } = await params
  const outreachId = parsePositiveListId(rawOutreachId)
  if (outreachId === undefined) notFound()

  return (
    <ThemeDetailPage
      outreachId={outreachId}
      themeId={themeId}
      isServe={isServe}
    />
  )
}
