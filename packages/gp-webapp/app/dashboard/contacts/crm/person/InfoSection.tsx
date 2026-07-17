import { Card, CardTitle } from '@styleguide'

// Shared card wrapper for PersonOverlay's detail sections (Contact
// Information, Voter Demographics, Activity Feed, Notes, ...). Extracted from
// PersonOverlay so NotesSection can reuse the same visual shell without a
// circular import (NotesSection is mounted from PersonOverlay).
export const InfoSection: React.FC<{
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}> = ({ title, icon, children }) => (
  <Card className="p-4">
    <div className="flex items-center justify-between">
      <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      {icon}
    </div>
    <div className="flex flex-col gap-4">{children}</div>
  </Card>
)
