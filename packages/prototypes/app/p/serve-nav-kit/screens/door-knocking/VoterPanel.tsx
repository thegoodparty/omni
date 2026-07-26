'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from '@goodparty_org/styleguide'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ContactRound,
  DoorOpen,
  FolderOpen,
  Home,
  Mail,
  MapPin,
  MessageSquare,
  Mic,
  Phone,
  Search,
  Smile,
  Sparkles,
  User,
} from 'lucide-react'
import {
  type ActivityKind,
  type Engagement,
  type DoorOutcome,
  type Resident,
  type ResidentStatus,
  type Support,
  type Voter,
  type WillVote,
  EDUCATION_LABEL,
  ETHNICITY_LABEL,
  INCOME_LABEL,
  LANGUAGE_LABEL,
  MARITAL_LABEL,
  PARTY_LABEL,
  STATUS_DOT,
  VOTER_STATUS_LABEL,
  getDoorOutcomeMeta,
  getResidents,
  getTalkingPoints,
  residentGender,
} from './doorKnockingData'

type Props = {
  voter: Voter | null
  voterIndex?: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (next: Voter) => void
  onRemove?: (
    voter: Voter,
    reason: 'moved' | 'opt_out',
    residentId: string,
  ) => void
  initialResidentId?: string
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
}

const residentMeta = (
  voter: Voter,
  r: Resident,
): { label: string; color: string } => {
  const stored = voter.residentStatuses?.[r.id]
  const isPrimary = r.relation === 'self'
  const status: ResidentStatus = stored?.reached
    ? stored
    : isPrimary && voter.reached
      ? {
          reached: true,
          outcome: voter.outcome,
          support: voter.support,
          willVote: voter.willVote,
          engagement: voter.engagement,
        }
      : { reached: false }
  const meta = getDoorOutcomeMeta(status)
  return meta
    ? { label: meta.label, color: STATUS_DOT[meta.color] }
    : { label: 'Not visited', color: 'bg-muted-foreground/40' }
}

const ACTIVITY_ICONS: Record<
  ActivityKind,
  React.ComponentType<{ className?: string }>
> = {
  knocked: DoorOpen,
  called: Phone,
  texted: MessageSquare,
  emailed: Mail,
  voice_note: Mic,
}

const formatActivityDate = (iso: string) => {
  const d = new Date(iso)
  const day = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const time = d
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace('AM', 'a.m.')
    .replace('PM', 'p.m.')
  return `${day}, at ${time}`
}

export const VoterPanel = ({
  voter,
  voterIndex,
  open,
  onOpenChange,
  onSave,
  onRemove,
  initialResidentId,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: Props) => {
  const isMobile = useIsMobile()
  const [outcome, setOutcome] = useState<DoorOutcome | undefined>()
  const [engagement, setEngagement] = useState<Engagement | undefined>()
  const [support, setSupport] = useState<Support | undefined>()
  const [willVote, setWillVote] = useState<WillVote | undefined>()
  const [note, setNote] = useState('')
  const [recording, setRecording] = useState(false)
  const [removeReason, setRemoveReason] = useState('')
  const [residentIdx, setResidentIdx] = useState(0)

  const residents = useMemo(() => (voter ? getResidents(voter) : []), [voter])
  const selected = residents[residentIdx] ?? residents[0]

  useEffect(() => {
    if (open && voter) {
      const list = getResidents(voter)
      const idx = initialResidentId
        ? list.findIndex((r) => r.id === initialResidentId)
        : -1
      setResidentIdx(idx >= 0 ? idx : 0)
    }
  }, [open, voter, initialResidentId])

  useEffect(() => {
    setOutcome(undefined)
    setEngagement(undefined)
    setSupport(undefined)
    setWillVote(undefined)
    setNote('')
    setRemoveReason('')
  }, [open, voter?.id, selected?.id])

  if (!voter) return null

  const cancel = () => {
    setOutcome(undefined)
    setEngagement(undefined)
    setSupport(undefined)
    setWillVote(undefined)
    setNote('')
    setRemoveReason('')
  }

  const save = () => {
    if (outcome === 'answered' && engagement === 'other') {
      if (!onRemove || !removeReason.trim()) return
      const residentId = selected?.id ?? `${voter.id}-resident-0`
      onRemove(voter, removeReason.trim() as 'moved' | 'opt_out', residentId)
      onOpenChange(false)
      return
    }
    if (outcome === 'answered' && engagement === 'engaged') {
      if (!support || !willVote) return
    }
    const now = new Date().toISOString()
    const summary =
      outcome === 'not_home'
        ? 'Not home'
        : outcome === 'not_accessible'
          ? 'Inaccessible'
          : engagement === 'refused'
            ? 'Refused to engage'
            : [
                support ? `Support: ${support}` : null,
                willVote ? `Will vote: ${willVote}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Answered'
    const name = selected?.name ?? voter.name
    const isPrimary = !selected || selected.relation === 'self'
    const residentId = selected?.id ?? `${voter.id}-resident-0`
    // Non-primary residents get a "Spoke with …" prefix, saved even with no note.
    const residentNote = !isPrimary ? `Spoke with ${name}. ` : ''
    onSave({
      ...voter,
      ...(isPrimary
        ? { reached: true, outcome, support, willVote, engagement, note }
        : {}),
      residentStatuses: {
        ...(voter.residentStatuses ?? {}),
        [residentId]: {
          reached: true,
          outcome,
          support,
          willVote,
          engagement,
          note,
        },
      },
      activity: [
        {
          kind: 'knocked',
          label: isPrimary ? 'Door knocking' : `Door knocking · ${name}`,
          detail: summary,
          notes: note.trim()
            ? `${residentNote}${note.trim()}`
            : residentNote.trim() || undefined,
          at: now,
          residentId,
        },
        ...(voter.activity ?? []),
      ],
    })
    onOpenChange(false)
  }

  const fakeVoice = () => {
    setRecording(true)
    setTimeout(() => {
      setRecording(false)
      const transcript =
        'Open to talking again next week. Concerned about Riverside Way traffic.'
      setNote((n) => (n ? n + ' ' : '') + transcript)
    }, 1100)
  }

  const gender = selected ? residentGender(selected.name) : 'Male'
  const addressParts = voter.address.split(',').map((s) => s.trim())
  const street = addressParts[0] ?? voter.address
  const cityStateZip = addressParts.slice(1).join(', ')
  const talkingPoints = selected ? getTalkingPoints(selected) : []
  const activity = (voter.activity ?? []).filter((e) => {
    const currentId = selected?.id ?? `${voter.id}-resident-0`
    return (e.residentId ?? `${voter.id}-resident-0`) === currentId
  })

  const supportView = (() => {
    const stored = selected ? voter.residentStatuses?.[selected.id] : undefined
    const isPrimary = selected?.relation === 'self'
    const s = stored?.support ?? (isPrimary ? voter.support : undefined)
    const w = stored?.willVote ?? (isPrimary ? voter.willVote : undefined)
    const fmt = (v?: string) =>
      v === 'yes'
        ? 'Yes'
        : v === 'no'
          ? 'No'
          : v === 'unknown'
            ? 'Unsure'
            : 'Not logged'
    return { support: fmt(s), willVote: fmt(w) }
  })()

  const body = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="bg-background sticky top-0 z-10 px-5 pt-5 pb-3">
          <div className="flex items-start gap-2">
            {onPrev && (
              <IconButton
                variant="ghost"
                size="small"
                onClick={onPrev}
                disabled={!hasPrev}
                aria-label="Previous stop"
                className="mt-1 shrink-0 rounded-full"
              >
                <ChevronLeft className="size-5" />
              </IconButton>
            )}
            {voterIndex ? (
              <span className="bg-primary text-primary-foreground mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {voterIndex}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="text-foreground text-2xl leading-tight font-bold">
                {selected?.name ?? voter.name}
              </h2>
              <p className="text-foreground mt-1 text-base font-semibold">
                {gender}, {selected?.age ?? voter.age} years old
              </p>
            </div>
            {onNext && (
              <IconButton
                variant="ghost"
                size="small"
                onClick={onNext}
                disabled={!hasNext}
                aria-label="Next stop"
                className="mt-1 ml-auto shrink-0 rounded-full"
              >
                <ChevronRight className="size-5" />
              </IconButton>
            )}
          </div>
          {residents.length > 1 && (
            <Tabs
              value={String(residentIdx)}
              onValueChange={(v) => setResidentIdx(Number(v))}
              className="mt-3 w-full"
            >
              <TabsList className="scrollbar-none flex h-auto w-full justify-start gap-0 overflow-x-auto">
                {residents.map((r, idx) => {
                  const meta = residentMeta(voter, r)
                  return (
                    <TabsTrigger
                      key={r.id}
                      value={String(idx)}
                      className="shrink-0 gap-1.5"
                    >
                      <User className="size-3" />
                      {r.name}
                      <span
                        aria-label={meta.label}
                        className={cn('ml-1 size-2 rounded-full', meta.color)}
                      />
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
          )}
        </div>

        <div className="space-y-4 px-5">
          <ProfileCard title="Talking points" icon={MessageSquare}>
            <p className="text-muted-foreground mb-3 text-xs">
              AI-generated from this voter&apos;s profile and your candidate
              info.
            </p>
            <ul className="space-y-2">
              {talkingPoints.map((point, idx) => (
                <li key={idx} className="text-foreground flex gap-2 text-sm">
                  <span className="bg-foreground mt-1.5 size-1.5 shrink-0 rounded-full" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </ProfileCard>

          <ProfileCard title="Contact information" icon={ContactRound}>
            <Field label="Address">
              <p className="text-sm">{street}</p>
              {cityStateZip && <p className="text-sm">{cityStateZip}</p>}
            </Field>
            <Button
              variant="outline"
              className="w-full rounded-full"
              onClick={() =>
                window.open(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(voter.address)}`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              <MapPin className="size-4" />
              Open in Maps
            </Button>
            <Field label="Cell phone number">Unknown</Field>
            <Field label="Landline">Unknown</Field>
          </ProfileCard>

          <ProfileCard title="Household" icon={Home}>
            <ul className="space-y-2">
              {residents.map((r) => {
                const meta = residentMeta(voter, r)
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="text-foreground text-sm font-medium">
                      {r.name}
                    </span>
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
                      <span className={cn('size-2 rounded-full', meta.color)} />
                      {meta.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </ProfileCard>

          <ProfileCard title="Voter demographics" icon={ClipboardList}>
            <Field label="Registered voter">
              {selected?.registered ? 'Yes' : 'No'}
            </Field>
            <Field label="Voter status">
              {VOTER_STATUS_LABEL[selected?.voterStatus ?? voter.voterStatus]}
            </Field>
            <Field label="Political party">
              {PARTY_LABEL[selected?.party ?? voter.party]}
            </Field>
          </ProfileCard>

          <ProfileCard title="Voter Support" icon={BadgeCheck}>
            <Field label="Do they support you?">{supportView.support}</Field>
            <Field label="Will they vote?">{supportView.willVote}</Field>
          </ProfileCard>

          <ProfileCard title="Demographic information" icon={FolderOpen}>
            <Field label="Marital status">
              {MARITAL_LABEL[selected?.maritalStatus ?? voter.maritalStatus]}
            </Field>
            <Field label="Has children under 18">
              {selected?.hasChildrenUnder18 ? 'Yes' : 'No'}
            </Field>
            <Field label="Veteran status">
              {selected?.veteran ? 'Yes' : 'No'}
            </Field>
            <Field label="Homeowner">
              {selected?.homeowner ? 'Yes' : 'No'}
            </Field>
            <Field label="Business owner">
              {selected?.businessOwner ? 'Yes' : 'No'}
            </Field>
            <Field label="Level of education">
              {EDUCATION_LABEL[selected?.education ?? voter.education]}
            </Field>
            <Field label="Estimated income range">
              {INCOME_LABEL[selected?.incomeRange ?? voter.incomeRange]}
            </Field>
            <Field label="Language">
              {LANGUAGE_LABEL[selected?.language ?? voter.language]}
            </Field>
            <Field label="Ethnicity group">
              {ETHNICITY_LABEL[selected?.ethnicity ?? voter.ethnicity]}
            </Field>
          </ProfileCard>

          <ProfileCard title="Activity feed" icon={Smile}>
            {activity.length === 0 ? (
              <div className="flex flex-col items-center py-4">
                <Search className="text-primary/60 size-10" />
                <p className="text-muted-foreground mt-3 text-sm">
                  Data not available.
                </p>
              </div>
            ) : (
              <ul className="space-y-4">
                {activity.map((e, idx) => {
                  const Icon = ACTIVITY_ICONS[e.kind]
                  return (
                    <li key={`${e.at}-${idx}`}>
                      <div className="flex items-start gap-2 text-sm">
                        <Icon className="text-foreground mt-0.5 size-4 shrink-0" />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-x-2">
                            <span className="text-foreground font-semibold">
                              {e.label}
                            </span>
                            {e.detail && (
                              <span className="text-muted-foreground">
                                {e.detail}
                              </span>
                            )}
                          </div>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {formatActivityDate(e.at)}
                          </p>
                          {e.notes && (
                            <div className="bg-muted/50 mt-2 rounded-md px-3 py-2">
                              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                                Notes
                              </p>
                              <p className="text-foreground mt-1 text-sm leading-relaxed">
                                {e.notes}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </ProfileCard>
        </div>
      </div>

      {/* Sticky log-visit bar */}
      <div className="border-border bg-background shrink-0 border-t px-5 pt-3 pb-4">
        <div className="space-y-4">
          <FieldGroup label="Did they answer?">
            <FilterPillGroup
              type="single"
              value={outcome ?? ''}
              onValueChange={(v) => {
                setOutcome((v as DoorOutcome) || undefined)
                setEngagement(undefined)
                setSupport(undefined)
                setWillVote(undefined)
              }}
            >
              <FilterPill value="answered">Answered</FilterPill>
              <FilterPill value="not_home">Not home</FilterPill>
              <FilterPill value="not_accessible">Inaccessible</FilterPill>
            </FilterPillGroup>
          </FieldGroup>

          {(outcome === 'not_home' || outcome === 'not_accessible') && (
            <InlineActions onCancel={cancel} onSave={save} />
          )}

          {outcome === 'answered' && (
            <>
              <FieldGroup label="Did they engage?">
                <FilterPillGroup
                  type="single"
                  value={engagement ?? ''}
                  onValueChange={(v) => {
                    setEngagement((v as Engagement) || undefined)
                    setSupport(undefined)
                    setWillVote(undefined)
                    setRemoveReason('')
                  }}
                >
                  <FilterPill value="engaged">Engaged</FilterPill>
                  <FilterPill value="refused">Refused</FilterPill>
                  <FilterPill value="other">Not voter</FilterPill>
                </FilterPillGroup>
              </FieldGroup>

              {engagement === 'refused' && (
                <InlineActions onCancel={cancel} onSave={save} />
              )}

              {engagement === 'other' && (
                <div className="space-y-4">
                  <FieldGroup label="What happened?">
                    <FilterPillGroup
                      type="single"
                      value={removeReason}
                      onValueChange={(v) => setRemoveReason(v)}
                    >
                      <FilterPill value="moved">Moved</FilterPill>
                      <FilterPill value="opt_out">Deceased</FilterPill>
                    </FilterPillGroup>
                  </FieldGroup>
                  {removeReason === 'moved' && (
                    <p className="text-muted-foreground text-sm">
                      We will remove this address from{' '}
                      {selected?.name ?? voter.name}&apos;s voter record.
                    </p>
                  )}
                  {removeReason === 'opt_out' && (
                    <p className="text-muted-foreground text-sm">
                      We will remove {selected?.name ?? voter.name} from your
                      voter list.
                    </p>
                  )}
                  <InlineActions
                    onCancel={cancel}
                    onSave={save}
                    saveDisabled={!removeReason.trim()}
                  />
                </div>
              )}

              {engagement === 'engaged' && (
                <>
                  <FieldGroup label="Do they support you?">
                    <FilterPillGroup
                      type="single"
                      value={support ?? ''}
                      onValueChange={(v) =>
                        setSupport((v as Support) || undefined)
                      }
                    >
                      <FilterPill value="yes">Yes</FilterPill>
                      <FilterPill value="no">No</FilterPill>
                      <FilterPill value="unknown">Unsure</FilterPill>
                    </FilterPillGroup>
                  </FieldGroup>

                  {support && (
                    <FieldGroup label="Will they vote this election?">
                      <FilterPillGroup
                        type="single"
                        value={willVote ?? ''}
                        onValueChange={(v) =>
                          setWillVote((v as WillVote) || undefined)
                        }
                      >
                        <FilterPill value="yes">Yes</FilterPill>
                        <FilterPill value="no">No</FilterPill>
                        <FilterPill value="unknown">Unsure</FilterPill>
                      </FilterPillGroup>
                    </FieldGroup>
                  )}

                  {support && willVote && (
                    <>
                      <FieldGroup label="Note">
                        <div className="relative">
                          <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="What did they say? We'll clean it up."
                            className="min-h-[88px] pr-12"
                          />
                          <IconButton
                            variant="ghost"
                            size="medium"
                            aria-label="Voice note"
                            onClick={fakeVoice}
                            className="absolute right-2 bottom-2 rounded-full"
                          >
                            <Mic
                              className={cn(
                                'size-5',
                                recording && 'animate-pulse',
                              )}
                            />
                          </IconButton>
                        </div>
                        {note && (
                          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                            <Sparkles className="size-3" /> Saves to this
                            person&apos;s activity feed.
                          </p>
                        )}
                      </FieldGroup>
                      <InlineActions onCancel={cancel} onSave={save} />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{voter.name}</DrawerTitle>
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
          <SheetTitle>{voter.name}</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  )
}

const InlineActions = ({
  onCancel,
  onSave,
  saveDisabled = false,
}: {
  onCancel: () => void
  onSave: () => void
  saveDisabled?: boolean
}) => (
  <div className="flex flex-col gap-2 pt-1">
    <Button className="w-full" onClick={onSave} disabled={saveDisabled}>
      Save
    </Button>
    <Button variant="outline" className="w-full" onClick={onCancel}>
      Cancel
    </Button>
  </div>
)

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
      <h3 className="text-foreground text-base font-semibold">{title}</h3>
      <Icon className="text-foreground size-5" />
    </div>
    <div className="border-border space-y-4 border-t px-4 py-4">{children}</div>
  </Card>
)

const Field = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <div>
    <p className="text-muted-foreground text-sm">{label}</p>
    <div className="text-foreground mt-0.5 text-sm font-medium">{children}</div>
  </div>
)

const FieldGroup = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <div>
    <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
      {label}
    </p>
    <div className="mt-2">{children}</div>
  </div>
)
