import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Button, CropIcon } from '@styleguide'
import type { ShowListMap } from '@goodparty_org/contracts'
import { ringFromGeoJsonPolygon } from 'app/dashboard/shared/ringGeometry'
import { getContactsLabels } from 'app/dashboard/shared/contactsLabels'
import { useListPeople } from '../../../contacts/crm/map/useListPeople'
import { useSavedList } from '../../../contacts/crm/map/useSavedList'

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

interface ChatListMapProps extends ShowListMap {
  // Asks the chat body to open the drawing surface for this list. Absent on
  // a transcript that cannot draw — and the body owns the overlay rather
  // than this component because a streaming turn's row is rebuilt under a
  // new key when it commits, which would unmount an overlay mounted here
  // and throw away a ring mid-draw.
  onRefineArea?: (list: ShowListMap) => void
}

export default function ChatListMap({
  listId,
  name,
  onRefineArea,
}: ChatListMapProps) {
  const { people, total, truncated, isLoading, isError } = useListPeople(listId)
  // Serve-only surface, so the labels are the constituent ones.
  const labels = getContactsLabels(false)
  const { list } = useSavedList(listId)
  const savedRing = ringFromGeoJsonPolygon(list?.geoPoly)
  // Outreach locks a list permanently, and the write behind this button
  // 409s once that happens. Hidden rather than disabled, matching the list
  // detail sheet: there is nothing the holder can do here, and the place
  // that explains duplicating is the list itself.
  const canRefine = Boolean(onRefineArea) && !list?.firstUsedForOutreachAt

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
              so the dots are markers. A saved boundary still draws, without
              a writer, so the map shows the geography the list was cut
              with even when it cannot be re-cut here. */}
          <ContactListMap people={people} drawRing={savedRing} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {truncated
            ? `Showing the first ${people.length.toLocaleString()}.`
            : ''}
        </span>
        <div className="flex items-center gap-1">
          {canRefine ? (
            <Button
              type="button"
              variant="outline"
              size="small"
              className="gap-2"
              onClick={() => onRefineArea?.({ listId, name })}
            >
              <CropIcon className="size-4" aria-hidden />
              {savedRing.length >= 3
                ? labels.boundaryEditCta
                : labels.boundaryDrawCta}
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="small">
            <Link href={listHref(listId)}>Open list</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
