'use client'

import { useEffect } from 'react'
import {
  type PhoneBankingCallResult,
  type PhoneBankingListEntry,
  VOTER_NAME_TOKEN,
} from '@goodparty_org/contracts'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import {
  Button,
  Card,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleUserRoundIcon,
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  IconButton,
  NotebookPenIcon,
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
  entryIndex: number
  activePersonId: string
  onActivePersonChange: (personId: string) => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (results: PhoneBankingCallResult[]) => void
}

// Case-insensitive so a script emitted with different casing still matches;
// [.*+?^${}()|[\]\\] escapes every regex metacharacter the literal token
// contains (the brackets themselves).
const VOTER_NAME_TOKEN_PATTERN = new RegExp(
  `(${VOTER_NAME_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
  'gi',
)

// Renders the frozen script with every occurrence of the voter-name token
// swapped for the active contact's first name, set apart visually so
// callers can tell it's live data rather than part of the fixed script.
const renderScriptWithVoterName = (
  script: string,
  firstName: string,
): React.ReactNode =>
  script.split(VOTER_NAME_TOKEN_PATTERN).map((part, index) =>
    part.toLowerCase() === VOTER_NAME_TOKEN.toLowerCase() ? (
      <span key={index} className="font-semibold">
        {firstName}
      </span>
    ) : (
      part
    ),
  )

// Sheet on desktop, drawer on mobile — same split as
// crm/lists/ListDetailSheet and the design-source PhoneBankSession
// reference; segmented Tabs (not a pill row) for the per-person switcher on
// a shared number, per the ticket's "segmented per-person tabs" language.
export default function PhoneBankingEntryPanel({
  listId,
  script,
  entry,
  entryIndex,
  activePersonId,
  onActivePersonChange,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
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

  // Frozen lists predate `firstName` (ENG-10938), and an empty/whitespace
  // value is treated the same as absent — either way, fall back to the
  // first word of the frozen `name`.
  const firstName = person.firstName?.trim() || person.name.split(' ')[0] || ''
  const noLiveEnrichment = hasNoLiveEnrichment(person)
  const householdHasOthersUnlogged = entry.persons.some(
    (candidate) =>
      candidate.personId !== person.personId && !candidate.interaction,
  )
  const dialDigits = entry.phone.replace(/\D/g, '')

  const body = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-background px-4 pt-4 pb-3">
          <div className="flex items-start gap-2">
            <IconButton
              variant="ghost"
              size="small"
              onClick={onPrev}
              disabled={!hasPrev}
              aria-label="Previous contact"
              className="mt-1 shrink-0 rounded-full"
            >
              <ChevronLeftIcon size={20} />
            </IconButton>
            <span className="mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {entryIndex}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold leading-tight text-foreground">
                {person.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {[
                  person.age !== null ? `Age ${person.age}` : null,
                  person.party,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No details on file'}
              </p>
            </div>
            <IconButton
              variant="ghost"
              size="small"
              onClick={onNext}
              disabled={!hasNext}
              aria-label="Next contact"
              className="mt-1 ml-auto shrink-0 rounded-full"
            >
              <ChevronRightIcon size={20} />
            </IconButton>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {entry.persons.length > 1 && (
            <Tabs value={person.personId} onValueChange={onActivePersonChange}>
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

          <ProfileCard title="Contact information" icon={CircleUserRoundIcon}>
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
            <p className="text-xs text-muted-foreground">
              Opens your device&apos;s phone app
            </p>
            {noLiveEnrichment && (
              <p className="text-xs text-warning">
                This person may have moved — showing the frozen name and number
                from when this list was built.
              </p>
            )}
          </ProfileCard>

          <ProfileCard title="Call script" icon={ScrollTextIcon}>
            <p className="whitespace-pre-line text-sm text-foreground">
              {renderScriptWithVoterName(script, firstName)}
            </p>
          </ProfileCard>

          <ProfileCard title="Notes" icon={NotebookPenIcon}>
            <PhoneBankingNotes personId={person.personId} />
          </ProfileCard>
        </div>
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

const ProfileCard = ({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) => (
  <Card className="gap-0 overflow-hidden p-0">
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-base font-semibold text-foreground">{title}</span>
      <Icon className="size-5 text-foreground" />
    </div>
    <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm">
      {children}
    </div>
  </Card>
)
