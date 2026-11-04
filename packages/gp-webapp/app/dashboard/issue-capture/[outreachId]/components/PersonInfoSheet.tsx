import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Sheet,
  SheetContent,
  SheetTitle,
  Spinner,
} from '@styleguide'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import { useOrganization } from '@shared/organization-picker'
import { PersonRecord } from 'app/dashboard/contacts/crm/person/PersonOverlay'
import type { UploadRowContext } from 'app/dashboard/contacts/crm/person/ImportedContactInformation'
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
  bottomDrawerOnPhone = false,
  uploadRow,
}: {
  personId: string | null
  isServe: boolean
  onClose: () => void
  // A phone opens the record from below, as phone banking's call panel does.
  bottomDrawerOnPhone?: boolean
  uploadRow?: UploadRowContext
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
  const isMobile = useIsMobile()

  // Below a drawer's header row the record needs no top padding of its own.
  const renderBody = (className: string) => (
    <div className={className}>
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
          uploadRow={uploadRow}
        />
      ) : (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}
    </div>
  )

  if (bottomDrawerOnPhone && isMobile) {
    return (
      <Drawer
        open={personId !== null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        {/* Phone banking's call panel shell (PhoneBankingEntryPanel), handle
            included, so a record opens to the same height. */}
        <DrawerContent className="flex h-[92dvh] flex-col overflow-hidden p-0 data-[vaul-drawer-direction=bottom]:max-h-[92dvh]">
          <DrawerHandle className="mt-3 h-1.5 w-[120px]" />
          {/* The close sits in a header row, as in phone banking's panel,
              so the record scrolls under it rather than across it. */}
          <DrawerHeader className="py-0">
            <DrawerTitle className="sr-only">{copy.personInfo}</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {renderBody('px-6 pb-6')}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

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
        {renderBody('p-6')}
      </SheetContent>
    </Sheet>
  )
}

export default PersonInfoSheet
