import { CIVIC_PANEL_SEGMENT } from '@goodparty_org/contracts'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../../citizens-panel/citizensPanelCopy'
import { useContactsTable } from '../ContactsTableProvider'
import { useListPeople } from '../map/useListPeople'
import { SectionLabel } from './ListDetailSection'

// Who is on the built-in panel list, read through the same contacts query a
// saved list's map uses, so a name opens the same constituent record.
export default function CitizensPanelMembers() {
  const { selectPerson } = useContactsTable()
  const { people, isLoading, isError } = useListPeople(CIVIC_PANEL_SEGMENT)

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>{COPY.members}</SectionLabel>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">{COPY.listMembersError}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border">
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className="w-full px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
                onClick={() => selectPerson(person.id)}
              >
                {[person.firstName, person.lastName]
                  .filter(Boolean)
                  .join(' ') || COPY.unnamedMember}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
