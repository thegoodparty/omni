import pageMetaData from 'helpers/metadataHelper'
import { ContactsTableProvider } from '../crm/ContactsTableProvider'
import { ContactsPageGate } from '../crm/ContactsPageGate'
import candidateAccess from '../../shared/candidateAccess'

const meta = pageMetaData({
  title: 'Contacts  | GoodParty.org',
  description: 'Manage your campaign contacts.',
  slug: '/dashboard/contacts',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page() {
  await candidateAccess()
  return (
    <ContactsTableProvider>
      <ContactsPageGate />
    </ContactsTableProvider>
  )
}
