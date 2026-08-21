'use client'

import { useEffect } from 'react'
import type {
  PhoneBankingCallResult,
  PhoneBankingListEntry,
} from '@goodparty_org/contracts'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import {
  Button,
  Card,
  CircleUserRoundIcon,
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  PhoneIcon,
  ScrollTextIcon,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import PhoneBankingNotes from './PhoneBankingNotes'
import PhoneBankingOutcomeForm from './PhoneBankingOutcomeForm'
import {
  OUTCOME_DOT_CLASS,
  hasNoLiveEnrichment,
} from './phoneBankingOutcome.util'

interface PhoneBankingEntryPanelProps {
  listId: number
  script: string
  entry: PhoneBankingListEntry
  activePersonId: string
  onActivePersonChange: (personId: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (results: PhoneBankingCallResult[]) => void
}

// Sheet on desktop, drawer on mobile — same split as
// crm/lists/ListDetailSheet and the design-source PhoneBankSession
// reference; segmented Tabs (not a pill row) for the per-person switcher on
// a shared number, per the ticket's "segmented per-person tabs" language.
export default function PhoneBankingEntryPanel({
  listId,
  script,
  entry,
  activePersonId,
  onActivePersonChange,
  open,
  onOpenChange,
  onSaved,
}: PhoneBankingEntryPanelProps): React.JSX.Element {
  const isMobile = useIsMobile()
  const person =
    entry.persons.find((candidate) => candidate.personId === activePersonId) ??
    entry.persons[0]
  const viewedPersonId = person?.personId

  useEffect(() => {
    if (!open || !viewedPersonId) return
    trackEvent(EVENTS.Outreach.PhoneBanking.ContactViewed, {
      listId,
      contactId: viewedPersonId,
      listRank: entry.seq,
    })
    // Deliberately keyed on personId/entry.id (primitives), not the `person`
    // object — that object gets a fresh reference on every optimistic patch
    // from a save (applyCallResults), and re-firing "viewed" on a save the
    // panel is already open for would double-count a single view.
  }, [open, entry.id, entry.seq, listId, viewedPersonId])

  if (!person) return <></>

  const noLiveEnrichment = hasNoLiveEnrichment(person)
  const householdHasOthersUnlogged = entry.persons.some(
    (candidate) =>
      candidate.personId !== person.personId && !candidate.interaction,
  )
  const dialDigits = entry.phone.replace(/\D/g, '')

  const body = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {entry.persons.length > 1 && (
          <Tabs
            value={person.personId}
            onValueChange={onActivePersonChange}
            className="mb-4"
          >
            <TabsList>
              {entry.persons.map((candidate) => (
                <TabsTrigger
                  key={candidate.personId}
                  value={candidate.personId}
                >
                  {candidate.name}
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      candidate.interaction
                        ? OUTCOME_DOT_CLASS[candidate.interaction.outcome]
                        : 'bg-muted-foreground/40',
                    )}
                  />
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <h2 className="text-xl font-semibold text-foreground">{person.name}</h2>
        <p className="text-sm text-muted-foreground">
          {[person.age !== null ? `Age ${person.age}` : null, person.party]
            .filter(Boolean)
            .join(' · ') || 'No details on file'}
        </p>

        <Card className="mt-4 gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">
              Contact information
            </span>
            <CircleUserRoundIcon size={18} className="text-foreground" />
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <a className="underline" href={`tel:${dialDigits}`}>
                {entry.phone}
              </a>
            </div>
            {!noLiveEnrichment && person.address && (
              <div>
                <p className="text-xs text-muted-foreground">Address</p>
                <p>{person.address}</p>
              </div>
            )}
            {!noLiveEnrichment && person.cellPhone && (
              <div>
                <p className="text-xs text-muted-foreground">Cell phone</p>
                <a
                  className="underline"
                  href={`tel:${person.cellPhone.replace(/\D/g, '')}`}
                >
                  {person.cellPhone}
                </a>
              </div>
            )}
            {!noLiveEnrichment && person.landline && (
              <div>
                <p className="text-xs text-muted-foreground">Landline</p>
                <a
                  className="underline"
                  href={`tel:${person.landline.replace(/\D/g, '')}`}
                >
                  {person.landline}
                </a>
              </div>
            )}
            <Button asChild variant="outline" className="w-full">
              <a href={`tel:${dialDigits}`}>
                <PhoneIcon size={16} />
                Call
              </a>
            </Button>
            {noLiveEnrichment && (
              <p className="text-xs text-warning">
                This person may have moved — showing the frozen name and number
                from when this list was built.
              </p>
            )}
          </div>
        </Card>

        <Card className="mt-4 gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">
              Call script
            </span>
            <ScrollTextIcon size={18} className="text-foreground" />
          </div>
          <p className="whitespace-pre-line text-sm text-foreground">
            {script}
          </p>
        </Card>

        <Card className="mt-4 gap-3 p-4">
          <span className="text-sm font-semibold text-foreground">Notes</span>
          <PhoneBankingNotes personId={person.personId} />
        </Card>
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <PhoneBankingOutcomeForm
          key={person.personId}
          listId={listId}
          entryId={entry.id}
          entrySeq={entry.seq}
          personId={person.personId}
          interaction={person.interaction}
          householdHasOthersUnlogged={householdHasOthersUnlogged}
          onSaved={onSaved}
        />
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="flex h-[85dvh] max-h-[85dvh] flex-col overflow-hidden p-0">
          <DrawerHandle />
          <DrawerHeader className="sr-only">
            <DrawerTitle>{person.name}</DrawerTitle>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{person.name}</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  )
}
