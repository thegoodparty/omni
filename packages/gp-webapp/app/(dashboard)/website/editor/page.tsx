import pageMetaData from 'helpers/metadataHelper'
import WebsiteEditorPage from './components/WebsiteEditorPage'
import { fetchUserWebsite } from 'helpers/fetchUserWebsite'
import { redirect } from 'next/navigation'
import { WebsiteProvider } from '../components/WebsiteProvider'
import candidateAccess from '../../shared/candidateAccess'

const meta = pageMetaData({
  title: 'Website Editor | GoodParty.org',
  description: 'Website Editor',
  slug: '/website/editor',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  const website = await fetchUserWebsite()

  if (!website) {
    redirect('/website')
  }

  return (
    <WebsiteProvider website={website} contacts={null}>
      <WebsiteEditorPage pathname="/website/editor" />
    </WebsiteProvider>
  )
}
