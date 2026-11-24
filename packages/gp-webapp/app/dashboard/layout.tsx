import type { ReactNode } from 'react'
import { OrganizationScope } from '@shared/organization-picker'

// Above the page, so hooks a page calls in its own body (a per-row detail read,
// for one) are inside the scope and unmount on a switch. `DashboardLayout` is
// rendered by the pages themselves, so a scope inside it would leave those page
// body reads above the boundary — the 404 in ENG-10991.
const DashboardLayoutScope = ({
  children,
}: {
  children: ReactNode
}): React.JSX.Element => <OrganizationScope>{children}</OrganizationScope>

export default DashboardLayoutScope
