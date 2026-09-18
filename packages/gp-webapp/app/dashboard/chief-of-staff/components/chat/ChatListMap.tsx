import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Button } from '@styleguide'
import type { ShowListMap } from '@goodparty_org/contracts'
import { useListPeople } from '../../../contacts/crm/map/useListPeople'

// maplibre-gl touches `window` at module scope, so the canvas stays out of
// the server bundle. The chat around it is client-rendered either way.
const ContactListMap = dynamic(
  () => import('../../../contacts/crm/map/ContactListMap'),
  { ssr: false, loading: () => <MapFrame>Loading map…</MapFrame> },
)

const MapFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
    {children}
  </div>
)

// The list's own page, so the transcript is a starting point rather than a
// dead end: everything the map cannot do — opening a person, editing the
// filter, downloading — already exists there.
const listHref = (listId: number) => `/dashboard/contacts/lists/${listId}`

export default function ChatListMap({ listId, name }: ShowListMap) {
  const { people, total, truncated, isLoading, isError } = useListPeople(listId)

  return (
    <div className="my-3 w-full overflow-hidden rounded-lg border">
      <div className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-semibold">{name}</span>
        {!isLoading && !isError ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {total.toLocaleString()} constituents
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <MapFrame>Loading map…</MapFrame>
      ) : isError ? (
        <MapFrame>This list could not be mapped right now.</MapFrame>
      ) : people.length === 0 ? (
        <MapFrame>This list has no members yet.</MapFrame>
      ) : (
        <div className="h-64">
          {/* No onSelectPerson: a transcript has no person overlay to open,
              so the dots are markers. */}
          <ContactListMap people={people} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {truncated
            ? `Showing the first ${people.length.toLocaleString()}.`
            : ''}
        </span>
        <Button asChild variant="ghost" size="small">
          <Link href={listHref(listId)}>Open list</Link>
        </Button>
      </div>
    </div>
  )
}
