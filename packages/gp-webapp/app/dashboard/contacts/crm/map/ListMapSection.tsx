import dynamic from 'next/dynamic'
import { useContactsTable } from '../ContactsTableProvider'
import { SectionLabel } from '../lists/ListDetailSection'
import { useListPeople } from './useListPeople'

// maplibre-gl touches `window` at module scope, so the canvas cannot be part
// of the server bundle. The sheet this sits in is client-rendered either way;
// the dynamic import is about the canvas's own import graph, not this file's.
const ContactListMap = dynamic(() => import('./ContactListMap'), {
  ssr: false,
  loading: () => <MapFrame>Loading map…</MapFrame>,
})

const MapFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-64 items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
    {children}
  </div>
)

export default function ListMapSection({ listId }: { listId: number }) {
  const { selectPerson, currentlySelectedPersonId } = useContactsTable()
  const { people, truncated, total, isLoading, isError } = useListPeople(listId)

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Where they are</SectionLabel>
      {isLoading ? (
        <MapFrame>Loading map…</MapFrame>
      ) : isError ? (
        <MapFrame>This list could not be mapped right now.</MapFrame>
      ) : people.length === 0 ? (
        // An empty response means the list matches nobody, which is a
        // different thing from its members lacking coordinates. People with
        // no location still arrive here and are counted inside the map as
        // unmappable, so claiming "no location on file" at this branch
        // described a case that cannot reach it.
        <MapFrame>This list has no members yet.</MapFrame>
      ) : (
        <>
          <div className="h-64 overflow-hidden rounded-md border">
            <ContactListMap
              people={people}
              truncated={truncated}
              selectedPersonId={currentlySelectedPersonId}
              onSelectPerson={selectPerson}
            />
          </div>
          {truncated ? (
            <p className="text-xs text-muted-foreground">
              Showing the first {people.length.toLocaleString()} of{' '}
              {total.toLocaleString()}.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
