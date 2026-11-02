'use client'

import { CIVIC_PANEL_SEGMENT } from '@goodparty_org/contracts'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import { SERVE_CITIZENS_PANEL_COPY as PANEL_COPY } from '../../citizens-panel/citizensPanelCopy'
import { useContactsTable } from '../ContactsTableProvider'
import { useListPeople } from '../map/useListPeople'
import { formatPersonName } from '../person/PersonOverlay'
import { SectionLabel } from './ListDetailSection'

// The civic panel's members, each opening their record. The same read as
// the map above it (one request), and only names: no export of its own.
export const CivicPanelMembers = () => {
  const { selectPerson } = useContactsTable()
  const { people, total, truncated, isLoading, isError } =
    useListPeople(CIVIC_PANEL_SEGMENT)

  return (
    <div className="flex flex-col gap-2" data-testid="civic-panel-members">
      <SectionLabel>{PANEL_COPY.members}</SectionLabel>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          {PANEL_COPY.membersLoading}
        </p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          {PANEL_COPY.membersError}
        </p>
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{PANEL_COPY.empty}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {people.map((person) => {
              const where = [person.address.line1, person.address.city]
                .filter(Boolean)
                .join(', ')
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => selectPerson(person.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-grayscale-50"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {formatPersonName(person)}
                      </span>
                      {where ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {where}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRightIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </button>
                </li>
              )
            })}
          </ul>
          {truncated ? (
            <p className="text-xs text-muted-foreground">
              {PANEL_COPY.membersShown(people.length, total)}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
