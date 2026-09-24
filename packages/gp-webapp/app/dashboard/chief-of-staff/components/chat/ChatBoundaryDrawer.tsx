import { useMemo } from 'react'
import type { ShowListMap } from '@goodparty_org/contracts'
import { ringsFromGeoJsonShape } from 'app/dashboard/shared/ringGeometry'
import { getContactsLabels } from 'app/dashboard/shared/contactsLabels'
import { useListPeople } from '../../../contacts/crm/map/useListPeople'
import { useSavedList } from '../../../contacts/crm/map/useSavedList'
import { useSaveListBoundary } from '../../../contacts/crm/map/useSaveListBoundary'
import ListBoundaryOverlay from '../../../contacts/crm/map/ListBoundaryOverlay'

// The drawing surface a transcript's map opens into, mounted by the chat
// body rather than by the card that asks for it — see the comment on
// `refiningList` there. It is the SAME overlay the list detail sheet opens,
// writing through the same hook, so a boundary drawn in a conversation and
// one drawn on the list are the same act with the same rules: the shape
// narrows the list in place, its members freeze, and outreach locking the
// list mid-draw comes back as the neutral locked message rather than an
// error toast.
export default function ChatBoundaryDrawer({
  list,
  onClose,
}: {
  list: ShowListMap
  onClose: () => void
}) {
  const { people, truncated } = useListPeople(list.listId)
  const { list: saved } = useSavedList(list.listId)
  // In practice the row is already cached — the button that opens this only
  // appears once it has arrived — but the overlay reads its ring into
  // useState at mount and never again, so mounting it before the row exists
  // is unrecoverable rather than merely early. Cheap to refuse outright
  // instead of depending on the caller's gate staying correct.
  const hasRow = Boolean(saved)
  const labels = getContactsLabels(false)
  const savedRings = useMemo(
    () => ringsFromGeoJsonShape(saved?.geoPoly),
    [saved?.geoPoly],
  )
  const saveMutation = useSaveListBoundary(list.listId, 'chat', onClose)

  if (!hasRow) return null

  return (
    <ListBoundaryOverlay
      people={people}
      truncated={truncated}
      initialRings={savedRings}
      labels={labels}
      isSaving={saveMutation.isPending}
      onCancel={onClose}
      onSave={(rings) => saveMutation.mutate(rings)}
    />
  )
}
