import pageMetaData from 'helpers/metadataHelper'

const meta = pageMetaData({
  title: 'Volunteer | GoodParty.org',
  description: 'Volunteer',
  slug: '/volunteer',
})
export const metadata = meta

// Placeholder — the real volunteer home is ENG-11053. This ticket only
// builds the shell and the role-based routing into it.
export default function VolunteerPage(): React.JSX.Element {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <p className="text-base text-muted-foreground">
        Your volunteer dashboard is coming soon.
      </p>
    </div>
  )
}
