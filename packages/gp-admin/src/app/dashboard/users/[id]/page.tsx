import { Metadata } from 'next'
import { UserSection } from './components/UserSection'
import { ViewLayout } from './components/ViewLayout'
import { listCampaigns } from '@/app/dashboard/campaigns/actions'
import { listOrEmpty } from '@/shared/util/gpClient.util'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

export const metadata: Metadata = {
  title: 'User Details | GP Admin',
  description: 'View user details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  const [userId] = validateNumericParams(id)
  const { data: campaigns } = await listOrEmpty(listCampaigns(userId))
  const isPro = campaigns.some((c) => c.isPro === true)

  return (
    <ViewLayout>
      <UserSection isPro={isPro} />
    </ViewLayout>
  )
}
