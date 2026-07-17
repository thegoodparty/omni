import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../../../shared/candidateAccess'
import ListDetailPageGate from '../../crm/lists/ListDetailPageGate'

const meta = pageMetaData({
  title: 'List | GoodParty.org',
  description: 'View and manage a saved contacts list.',
  slug: '/dashboard/contacts/lists',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ listId: string }>
}

export default async function Page({
  params,
}: Props): Promise<React.JSX.Element> {
  await candidateAccess()
  const { listId } = await params
  return <ListDetailPageGate listId={listId} />
}
