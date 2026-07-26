'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea,
  cn,
  toast,
} from '@goodparty_org/styleguide'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import {
  ChevronLeft,
  ChevronRight,
  ContactRound,
  Download,
  MoreVertical,
  NotebookPen,
  Pencil,
  PhoneCall,
  ScrollText,
  Trash2,
} from 'lucide-react'
import { ScreenLayout } from '../../components/ScreenLayout'
import {
  type CallOutcome,
  type ContactState,
  type Engagement,
  type Note,
  type Support,
  type WillVote,
  DEFAULT_CALL_SCRIPT,
  OUTCOME_META,
  OUTCOME_ORDER,
  SUPPORT_LABEL,
} from './phoneBankData'
import {
  type Voter,
  ALL_VOTERS,
  PARTY_LABEL,
} from '../door-knocking/doorKnockingData'

type PhoneBankSessionPayload = {
  name: string
  audienceName: string
  script: string
  contactIds: string[]
}

type Props = {
  session: PhoneBankSessionPayload
  onExit: () => void
  aiPlaceholder?: string
}

// New notes need stable ids; a module counter keeps them predictable.
let noteSeq = 0

const formatNoteTimestamp = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export const PhoneBankSession = ({ session, onExit, aiPlaceholder }: Props) => {
  const contacts = useMemo<Voter[]>(
    () =>
      session.contactIds.length
        ? ALL_VOTERS.filter((v) => session.contactIds.includes(v.id))
        : ALL_VOTERS.filter((v) => v.phone).slice(0, 40),
    [session.contactIds],
  )

  const [state, setState] = useState<Record<string, ContactState>>({})
  const [activeId, setActiveId] = useState<string | null>(null)

  const total = contacts.length
  const title = session.name || session.audienceName || 'Phone bank'

  const counts = useMemo(() => {
    const c: Record<CallOutcome, number> = {
      answered: 0,
      no_answer: 0,
      voicemail: 0,
      wrong_number: 0,
      refused: 0,
    }
    for (const contact of contacts) {
      const o = state[contact.id]?.outcome
      if (o) c[o]++
    }
    return c
  }, [contacts, state])
  const reached = OUTCOME_ORDER.reduce((sum, o) => sum + counts[o], 0)
  const pct = (n: number) => (total ? (n / total) * 100 : 0)

  const updateContact = (id: string, patch: Partial<ContactState>) =>
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const activeIdx = contacts.findIndex((c) => c.id === activeId)
  const activeContact = activeIdx >= 0 ? contacts[activeIdx]! : null
  const activeState = activeId ? (state[activeId] ?? {}) : {}

  const goPrev = () => {
    if (activeIdx > 0) setActiveId(contacts[activeIdx - 1]!.id)
  }
  const goNext = () => {
    if (activeIdx >= 0 && activeIdx < contacts.length - 1)
      setActiveId(contacts[activeIdx + 1]!.id)
  }

  return (
    <>
      <ScreenLayout
        title={title}
        aiPlaceholder={aiPlaceholder}
        bleed
        onBack={onExit}
        backLabel="Voter Outreach"
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="small"
              aria-label="Download PDF list"
              onClick={() => toast.success('PDF download started')}
            >
              <Download className="size-4" />
              <span className="hidden lg:inline">PDF</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="ghost"
                  size="small"
                  aria-label="More actions"
                >
                  <MoreVertical className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    toast.success('Phone bank deleted')
                    onExit()
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      >
        <div className="mx-auto w-full max-w-[608px] space-y-4 px-4 py-5 pb-28">
          {/* Call progress */}
          <Card className="gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Call progress
              </span>
              <Badge variant="secondary" shape="pill">
                {reached}/{total} called
              </Badge>
            </div>
            <div className="bg-muted flex h-2 overflow-hidden rounded-full">
              {OUTCOME_ORDER.map((o) => (
                <span
                  key={o}
                  className={OUTCOME_META[o].color}
                  style={{ width: `${pct(counts[o])}%` }}
                />
              ))}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
              {OUTCOME_ORDER.map((o) => (
                <span key={o} className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      'size-2.5 rounded-full',
                      OUTCOME_META[o].color,
                    )}
                  />
                  {OUTCOME_META[o].label} {counts[o]}
                </span>
              ))}
            </div>
          </Card>

          {/* Contacts */}
          <Card className="gap-0 overflow-hidden p-0">
            <div className="border-border bg-card flex items-center justify-between border-b p-4">
              <span className="text-foreground text-sm font-semibold">
                Contacts
              </span>
              <span className="text-muted-foreground text-sm">
                {total} people
              </span>
            </div>
            <ol className="divide-border divide-y">
              {contacts.map((c, i) => {
                const meta = state[c.id]?.outcome
                  ? OUTCOME_META[state[c.id]!.outcome!]
                  : null
                const active = activeId === c.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(c.id)}
                      className={cn(
                        'flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition-colors',
                        active ? 'bg-primary/10' : 'hover:bg-muted/50',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                            active
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground',
                          )}
                        >
                          {i + 1}
                        </span>
                        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                          {c.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 self-center">
                          {meta && (
                            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                              <span
                                className={cn(
                                  'size-2 rounded-full',
                                  meta.color,
                                )}
                              />
                              {meta.label}
                            </span>
                          )}
                          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                        </span>
                      </div>
                      <span className="text-muted-foreground truncate pl-9 text-xs">
                        {c.phone ?? 'No phone'}
                      </span>
                      <span className="text-muted-foreground truncate pl-9 text-xs">
                        {c.address}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </Card>
        </div>
      </ScreenLayout>

      <ContactDetail
        contact={activeContact}
        contactIndex={activeIdx >= 0 ? activeIdx + 1 : undefined}
        state={activeState}
        script={session.script}
        open={activeContact !== null}
        onOpenChange={(o) => !o && setActiveId(null)}
        onChange={(patch) =>
          activeContact && updateContact(activeContact.id, patch)
        }
        onPrev={goPrev}
        onNext={goNext}
        hasPrev={activeIdx > 0}
        hasNext={activeIdx >= 0 && activeIdx < contacts.length - 1}
      />
    </>
  )
}

type ContactDetailProps = {
  contact: Voter | null
  contactIndex?: number
  state: ContactState
  script: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<ContactState>) => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
}

const ContactDetail = ({
  contact,
  contactIndex,
  state,
  script,
  open,
  onOpenChange,
  onChange,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: ContactDetailProps) => {
  const isMobile = useIsMobile()

  const [outcome, setOutcome] = useState<CallOutcome | undefined>()
  const [engagement, setEngagement] = useState<Engagement | undefined>()
  const [support, setSupport] = useState<Support | undefined>()
  const [willVote, setWillVote] = useState<WillVote | undefined>()
  const [notes, setNotes] = useState<Note[]>([])
  const [draftNote, setDraftNote] = useState('')
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(true)

  useEffect(() => {
    setOutcome(state.outcome)
    setEngagement(state.engagement)
    setSupport(state.support)
    setWillVote(state.willVote)
    setNotes(state.notes ?? [])
    setDraftNote('')
    setIsAddingNote(false)
    setEditingNoteId(null)
    setIsEditing(!state.outcome)
  }, [
    state.outcome,
    state.engagement,
    state.support,
    state.willVote,
    state.notes,
    contact?.id,
  ])

  if (!contact) return null

  const openAddNote = () => {
    setEditingNoteId(null)
    setDraftNote('')
    setIsAddingNote(true)
  }

  const openEditNote = (n: Note) => {
    setIsAddingNote(false)
    setEditingNoteId(n.id)
    setDraftNote(n.text)
  }

  const cancelNoteForm = () => {
    setDraftNote('')
    setEditingNoteId(null)
    setIsAddingNote(false)
  }

  const handleSaveNote = () => {
    const text = draftNote.trim()
    if (!text) return
    const next = editingNoteId
      ? notes.map((n) =>
          n.id === editingNoteId ? { ...n, text, updatedAt: Date.now() } : n,
        )
      : [{ id: `note-${++noteSeq}`, text, createdAt: Date.now() }, ...notes]
    setNotes(next)
    onChange({ notes: next })
    cancelNoteForm()
  }

  const handleDeleteNote = (id: string) => {
    const next = notes.filter((n) => n.id !== id)
    setNotes(next)
    onChange({ notes: next })
  }

  const resetDraft = () => {
    setOutcome(state.outcome)
    setEngagement(state.engagement)
    setSupport(state.support)
    setWillVote(state.willVote)
    setIsEditing(!state.outcome)
  }

  const saveDraft = () => {
    onChange({ outcome, engagement, support, willVote })
    setIsEditing(false)
  }

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
                aria-label="Previous contact"
                className="mt-1 shrink-0 rounded-full"
              >
                <ChevronLeft className="size-5" />
              </IconButton>
            )}
            {contactIndex ? (
              <span className="bg-primary text-primary-foreground mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {contactIndex}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="text-foreground text-2xl leading-tight font-bold">
                {contact.name}
              </h2>
              <p className="text-foreground mt-1 text-base font-semibold">
                Age {contact.age} · Party {PARTY_LABEL[contact.party]}
              </p>
            </div>
            {onNext && (
              <IconButton
                variant="ghost"
                size="small"
                onClick={onNext}
                disabled={!hasNext}
                aria-label="Next contact"
                className="mt-1 ml-auto shrink-0 rounded-full"
              >
                <ChevronRight className="size-5" />
              </IconButton>
            )}
          </div>
        </div>

        <div className="space-y-4 px-5 pb-6">
          <ProfileCard title="Contact information" icon={ContactRound}>
            <Field label="Phone">{contact.phone ?? 'Unknown'}</Field>
            <Field label="Address">{contact.address}</Field>
            <Field label="Precinct">{contact.precinct}</Field>
            {contact.phone && (
              <Button asChild variant="outline" className="w-full rounded-full">
                <a href={`tel:${contact.phone}`}>
                  <PhoneCall className="size-4" />
                  Call
                </a>
              </Button>
            )}
          </ProfileCard>

          <ProfileCard title="Call script" icon={ScrollText}>
            <p className="text-foreground text-sm leading-relaxed whitespace-pre-line">
              {script || DEFAULT_CALL_SCRIPT}
            </p>
          </ProfileCard>

          <ProfileCard title="Notes" icon={NotebookPen}>
            {notes.length > 0 && (
              <ul className="divide-border -mx-1 divide-y">
                {notes.map((n) => {
                  const editingNote = editingNoteId === n.id
                  return (
                    <li key={n.id}>
                      {editingNote ? (
                        <div className="space-y-3 px-1 py-2.5">
                          <Textarea
                            value={draftNote}
                            onChange={(e) => setDraftNote(e.target.value)}
                            placeholder="Add a comment about this call…"
                            rows={4}
                          />
                          <div className="flex flex-col gap-2">
                            <Button
                              className="w-full"
                              onClick={handleSaveNote}
                              disabled={!draftNote.trim()}
                            >
                              Save changes
                            </Button>
                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={cancelNoteForm}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 px-1 py-2.5">
                          <p className="text-foreground text-sm leading-6 whitespace-pre-wrap">
                            {n.text}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                              {formatNoteTimestamp(n.createdAt)}
                              {n.updatedAt
                                ? ` · edited ${formatNoteTimestamp(n.updatedAt)}`
                                : ''}
                            </span>
                            <IconButton
                              variant="ghost"
                              size="small"
                              className="text-muted-foreground rounded-full"
                              onClick={() => openEditNote(n)}
                              aria-label="Edit note"
                            >
                              <Pencil className="size-4" />
                            </IconButton>
                            <IconButton
                              variant="ghost"
                              size="small"
                              className="text-destructive rounded-full"
                              onClick={() => handleDeleteNote(n.id)}
                              aria-label="Delete note"
                            >
                              <Trash2 className="size-4" />
                            </IconButton>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {isAddingNote ? (
              <div className="space-y-3">
                <Textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="Add a comment about this call…"
                  rows={4}
                />
                <div className="flex flex-col gap-2">
                  <Button
                    className="w-full"
                    onClick={handleSaveNote}
                    disabled={!draftNote.trim()}
                  >
                    Save note
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={cancelNoteForm}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              editingNoteId === null && (
                <Button className="w-full" onClick={openAddNote}>
                  <NotebookPen className="size-4" />
                  Add a note
                </Button>
              )
            )}
          </ProfileCard>
        </div>
      </div>

      {/* Sticky log-call bar. Shows a summary after save; edit to expand. */}
      <div className="border-border bg-background shrink-0 border-t px-5 pt-3 pb-4">
        {!isEditing && state.outcome ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
              <span className="text-foreground inline-flex items-center gap-1.5 text-sm font-medium">
                <span
                  className={cn(
                    'size-2.5 rounded-full',
                    OUTCOME_META[state.outcome].color,
                  )}
                />
                {OUTCOME_META[state.outcome].label}
              </span>
              {state.outcome === 'answered' &&
                state.engagement === 'engaged' && (
                  <>
                    {state.support && (
                      <span className="truncate">
                        {' · Support: '}
                        <span className="text-foreground font-medium">
                          {SUPPORT_LABEL[state.support]}
                        </span>
                      </span>
                    )}
                    {state.willVote && (
                      <span className="truncate">
                        {' · Will vote: '}
                        <span className="text-foreground font-medium">
                          {SUPPORT_LABEL[state.willVote]}
                        </span>
                      </span>
                    )}
                  </>
                )}
            </div>
            <IconButton
              variant="outline"
              size="small"
              onClick={() => setIsEditing(true)}
              aria-label="Edit"
              className="shrink-0 rounded-full"
            >
              <Pencil className="size-4" />
            </IconButton>
          </div>
        ) : (
          <div className="space-y-4">
            <FieldGroup label="Did they answer?">
              <FilterPillGroup
                type="single"
                value={outcome ?? ''}
                onValueChange={(v) => {
                  setOutcome((v as CallOutcome) || undefined)
                  setEngagement(undefined)
                  setSupport(undefined)
                  setWillVote(undefined)
                }}
              >
                {OUTCOME_ORDER.map((o) => (
                  <FilterPill key={o} value={o}>
                    {OUTCOME_META[o].label}
                  </FilterPill>
                ))}
              </FilterPillGroup>
            </FieldGroup>

            {outcome && outcome !== 'answered' && (
              <InlineActions onCancel={resetDraft} onSave={saveDraft} />
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
                    }}
                  >
                    <FilterPill value="engaged">Engaged</FilterPill>
                    <FilterPill value="refused">Refused</FilterPill>
                  </FilterPillGroup>
                </FieldGroup>

                {engagement === 'refused' && (
                  <InlineActions onCancel={resetDraft} onSave={saveDraft} />
                )}

                {engagement === 'engaged' && (
                  <>
                    <FieldGroup label="Do they support you?">
                      <FilterPillGroup
                        type="single"
                        value={support ?? ''}
                        onValueChange={(v) => {
                          // Source keeps the will-vote answer when support
                          // changes — only outcome/engagement clear downstream.
                          setSupport((v as Support) || undefined)
                        }}
                      >
                        <FilterPill value="yes">Yes</FilterPill>
                        <FilterPill value="no">No</FilterPill>
                        <FilterPill value="unsure">Unsure</FilterPill>
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
                          <FilterPill value="unsure">Unsure</FilterPill>
                        </FilterPillGroup>
                      </FieldGroup>
                    )}

                    {support && willVote && (
                      <InlineActions onCancel={resetDraft} onSave={saveDraft} />
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          closeClassName="hidden"
          className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)]"
        >
          <DrawerHandle />
          <DrawerHeader className="sr-only">
            <DrawerTitle>{contact.name}</DrawerTitle>
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
          <SheetTitle>{contact.name}</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  )
}

const InlineActions = ({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: () => void
}) => (
  <div className="flex flex-col gap-2 pt-1">
    <Button className="w-full" onClick={onSave}>
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

export default PhoneBankSession
