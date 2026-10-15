import { useQuery } from '@tanstack/react-query'
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
  const query = useQuery({
    ...cardContactQueryOptions(personId ?? '', orgSlug),
    enabled: personId !== null,
  })

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
              {copy.personInfoFailed}
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
