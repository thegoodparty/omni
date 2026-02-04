import { Metadata } from 'next'
import { stubbedElectedOffice } from '@/data/stubbed-elected-office'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { ElectedOfficeDisplaySection } from '../../components/ElectedOfficeDisplaySection'

export const metadata: Metadata = {
  title: 'Elected Office | GP Admin',
  description: 'View elected office details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ElectedOfficePage({ params }: PageProps) {
  const { id } = await params
  // TODO: Replace stubbed data with API call using id
  void id

  const electedOffice = stubbedCampaign.didWin ? stubbedElectedOffice : null

  return <ElectedOfficeDisplaySection electedOffice={electedOffice} />
}
