import pageMetaData from 'helpers/metadataHelper'
import AssignmentsPage from './components/AssignmentsPage'

const meta = pageMetaData({
  title: 'Volunteer | GoodParty.org',
  description: 'Volunteer',
  slug: '/volunteer',
})
export const metadata = meta

export default function VolunteerPage(): React.JSX.Element {
  return <AssignmentsPage />
}
