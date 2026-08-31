import pageMetaData from 'helpers/metadataHelper'
import serveAccess from '../shared/serveAccess'
import ConstituentOutreachPage from './ConstituentOutreachPage'

const meta = pageMetaData({
  title: 'Constituent Outreach | GoodParty.org',
  description: 'Constituent outreach',
  slug: '/dashboard/constituent-outreach',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()
  return <ConstituentOutreachPage pathname="/dashboard/constituent-outreach" />
}
