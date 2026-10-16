import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Sheet, SheetContent, SheetTitle, Spinner } from '@styleguide'
import { useOrganization } from '@shared/organization-picker'
import { PersonRecord } from 'app/dashboard/contacts/crm/person/PersonOverlay'
import { cardContactQueryOptions } from 'app/dashboard/shared/agent-chat/cards/cardQueries'
import { whatWeHeardCopy } from '../../copy'

// The person a note is about, as Voter Data's record shows them
// (`PersonRecord`), in a sheet over the report rather than off on another
// page. As in the chat's constituents card, the parts that read Voter Data's
// own table (the status row, top issues, the activity feed) are left out, and
// so is the map; the person query shares Voter Data's key, so an edit here
// shows there.
const PersonInfoSheet = ({
  personId,
  isServe,
  onClose,
}: {
  personId: string | null
  isServe: boolean
  onClose: () => void
}) => {
  const copy = whatWeHeardCopy(isServe)
  const orgSlug = useOrganization()?.slug
  // A 404 is a person outside the district's voter data, which a retry will
  // not change; anything else retries as the client's queries do.
  const clientRetry = useQueryClient().getDefaultOptions().queries?.retry ?? 3
  const query = useQuery({
    ...cardContactQueryOptions(personId ?? '', orgSlug),
    enabled: personId !== null,
    retry: (failures, error) =>
      error instanceof FetchError && error.status === 404
        ? false
        : typeof clientRetry === 'function'
          ? clientRetry(failures, error)
          : typeof clientRetry === 'number'
            ? failures < clientRetry
            : clientRetry,
  })
  // Gone, rather than failed: "try again" would promise a retry that cannot
  // help.
  const missing =
    query.error instanceof FetchError && query.error.status === 404

  return (
    <Sheet
      open={personId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/* Voter Data's own sheet shell (`PersonOverlay`), z-index included,
          so the record opens here the way it opens there. */}
      <SheetContent className="z-[1301] h-full w-screen overflow-y-auto sm:w-[90vw] sm:max-w-xl">
        <SheetTitle className="sr-only">{copy.personInfo}</SheetTitle>
        <div className="p-6">
          {query.isError ? (
            <p className="text-sm text-muted-foreground">
              {missing ? copy.personInfoMissing : copy.personInfoFailed}
            </p>
          ) : query.data ? (
            <PersonRecord
              key={query.data.id}
              person={query.data}
              isServe={isServe}
              showWinActivities={false}
              showMap={false}
            />
          ) : (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default PersonInfoSheet
