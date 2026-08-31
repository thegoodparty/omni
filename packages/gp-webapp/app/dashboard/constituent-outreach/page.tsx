import pageMetaData from 'helpers/metadataHelper'
import serveAccess from '../shared/serveAccess'
import ConstituentOutreachPage from './ConstituentOutreachPage'
import { serverRequest } from 'gpApi/server-request'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'

// The serve list route never 404s for a fresh org (empty array is a valid
// response). `ignoreResponseError` still guards the rare race where
// ElectedOffice is removed between serveAccess()'s check and this request —
// see gpApi/CLAUDE.md and app/dashboard/race-opponent/page.tsx for the same
// pattern: without it, ofetch.raw throws on any non-2xx and 500s the page.
const fetchOutreaches = async (): Promise<Outreach[]> => {
  const { ok, data } = await serverRequest(
    'GET /v1/outreach/serve',
    {},
    { ignoreResponseError: true },
  )
  return ok ? data : []
}

const meta = pageMetaData({
  title: 'Constituent Outreach | GoodParty.org',
  description: 'Constituent outreach',
  slug: '/dashboard/constituent-outreach',
})

export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()
  const outreaches = await fetchOutreaches()
  return (
    <ConstituentOutreachPage
      pathname="/dashboard/constituent-outreach"
      outreaches={outreaches}
    />
  )
}
