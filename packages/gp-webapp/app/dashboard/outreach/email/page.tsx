import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { EmailFlowPage } from '../v2/email/EmailFlowPage'
import { parsePositiveListId } from '../util/parsePositiveListId.util'

export const metadata = pageMetaData({
  title: 'Email | GoodParty.org',
  description: 'Email your voters.',
  slug: '/dashboard/outreach/email',
})
export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    draft?: string | string[]
    imported?: string | string[]
  }>
}): Promise<React.JSX.Element> {
  await candidateAccess()
  const { draft, imported } = await searchParams
  const draftId = parsePositiveListId(Array.isArray(draft) ? draft[0] : draft)
  return (
    <EmailFlowPage
      draftId={draftId}
      resumeImport={(Array.isArray(imported) ? imported[0] : imported) === '1'}
    />
  )
}
