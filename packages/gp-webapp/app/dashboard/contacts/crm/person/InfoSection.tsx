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
  <Card className="p-0 gap-0">
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      {icon}
    </div>
    <div className="flex flex-col gap-4 p-4">{children}</div>
  </Card>
)
