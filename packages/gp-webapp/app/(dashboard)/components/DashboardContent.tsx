'use client'

import DashboardLayout from '../shared/DashboardLayout'
import { NAV_LABELS } from '../shared/navLabels'
import Home from '../home/Home'
import { WebsiteSunsetModalController } from '../shared/WebsiteSunsetModalController'

interface DashboardContentProps {
  pathname: string
  sunsetEligible: boolean
}

export default function DashboardContent({
  pathname,
  sunsetEligible,
}: DashboardContentProps): React.JSX.Element {
  return (
    <DashboardLayout
      pathname={pathname}
      showAlert={false}
      wrapperClassName="!p-0"
      navHeader={{ icon: 'house', label: NAV_LABELS.home }}
    >
      <WebsiteSunsetModalController eligible={sunsetEligible} />
      <Home />
    </DashboardLayout>
  )
}
