import { Metadata } from 'next'
import { stubbedElectedOffice } from '@/data/stubbed-elected-office'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { ElectedOfficeDisplaySection } from '../components/ElectedOfficeDisplaySection'
import { ViewLayout } from '../components/ViewLayout'

export const metadata: Metadata = {
  title: 'Elected Office | GP Admin',
  description: 'View elected office details',
}

export default function ElectedOfficePage() {
  const electedOffice = stubbedCampaign.didWin ? stubbedElectedOffice : null

  return (
    <ViewLayout>
      <ElectedOfficeDisplaySection electedOffice={electedOffice} />
    </ViewLayout>
  )
}
