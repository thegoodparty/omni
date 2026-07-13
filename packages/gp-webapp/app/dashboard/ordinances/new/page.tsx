import serveAccess from '../../shared/serveAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import NewOrdinanceForm from '../components/NewOrdinanceForm'

export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  return (
    <DashboardLayout pathname="/dashboard/ordinances/new" showAlert={false}>
      <NewOrdinanceForm />
    </DashboardLayout>
  )
}
