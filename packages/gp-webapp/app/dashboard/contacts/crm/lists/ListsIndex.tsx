'use client'

import { useContactsTable } from '../ContactsTableProvider'
import { getContactsLabels } from '../../../shared/contactsLabels'
import ListCard from './ListCard'

// ENG-10721 (locked-prototype parity): replaces the ListsTable table with a
// card grid under a "Voter Lists" / "Constituent Lists" section heading.
export default function ListsIndex() {
  const { customSegments, isWinContext } = useContactsTable()
  const labels = getContactsLabels(isWinContext)

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">{labels.listsSectionTitle}</h2>
        <p className="text-sm text-muted-foreground">
          {labels.listsSectionSubtitle}
        </p>
      </div>

      {customSegments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You haven&apos;t created any lists yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {customSegments.map((segment) => (
            <ListCard key={segment.id} segment={segment} />
          ))}
        </div>
      )}
    </section>
  )
}
