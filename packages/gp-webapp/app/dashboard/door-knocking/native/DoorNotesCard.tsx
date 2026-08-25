'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ContactNote } from '@goodparty_org/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  IconButton,
  NotebookPenIcon,
  PencilIcon,
  Textarea,
  Trash2Icon,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import { DictationMicButton } from 'app/dashboard/shared/dictation/DictationMicButton'
import { DictationFeedback } from 'app/dashboard/briefings/shared/DictationFeedback'
import SheetSectionHeader from './SheetSectionHeader'
import { DoorNoteList } from './doorNotes'

// Mirrors ContactNoteInputSchema's `body.max(10_000)`, so the field cannot
// accept text the API will reject — the same constant the CRM's own notes
// section and the phone-banking one hold, for the same reason.
const NOTE_BODY_MAX_LENGTH = 10_000

// Local time, unlike anything the paper surfaces print. `walkFacts.ts` formats
// in UTC and drops the day because both paper renderers run in Node, whose
// clock is UTC, so a door knocked at 9pm anywhere in the US would print as the
// following day. This card renders in the canvasser's own browser, so the
// opposite is true: the phone's zone is the right one, and it is the only place
// the exact time of a note is worth printing at all.
const formatNoteDate = (dateStr: string): string =>
  format(new Date(dateStr), 'MMM d, yyyy, h:mm a')

interface DoorNotesCardProps {
  personId: string
  notes: DoorNoteList
  onCreated: (note: ContactNote) => void
  onUpdated: (note: ContactNote) => void
  onDeleted: (noteId: string) => void
}

// ADR 0011's Notes section, at the door. The 2026-08-20 product call asked for
// saved notes that carry the date and time they were written, can be edited and
// deleted later, and all appear in one place.
//
// **Nothing here fetches.** The list is seeded from `target.notes` on the route
// payload, which is the whole reason ADR 0011 put it there: a canvasser reads
// this while standing on a porch, and a card that needs a round trip is a blank
// card during the conversation. Reads ride the payload; writes do not, and that
// asymmetry is deliberate rather than an omission — a failed write is visible
// to the person who caused it and still has their text, while a failed read
// looks exactly like a resident nobody has ever written about.
//
// The list after a write is held in local state above this card (see
// `doorNotes.ts`) rather than refetched. Asking for a whole route serve — this
// feature's heaviest read — because someone typed a sentence is the per-door
// fetch ADR 0009 rejected, and the response to a create or an edit is the row
// itself, so there is nothing left to go and ask for.
export default function DoorNotesCard({
  personId,
  notes,
  onCreated,
  onUpdated,
  onDeleted,
}: DoorNotesCardProps) {
  const [isComposing, setIsComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')

  // On the compose field only. Dictating is what makes a free-text box usable
  // one-handed on a doorstep in the rain, which is the argument that already
  // put the shared stack on the knock form's note. Editing is a different job —
  // it is fixing a word, and a transcript that appends to the end is no help
  // with that — so the edit textarea stays plain rather than growing a second
  // live session this card would then have to keep mutually exclusive.
  const dictation = useDictationAppend({
    analyticsLabel: 'door_knocking_note',
    value: draft,
    // The textarea's maxLength only constrains typing, so a long dictation
    // would append straight past it; the same ceiling is enforced here.
    onChange: (next) => setDraft(next.slice(0, NOTE_BODY_MAX_LENGTH)),
  })

  const create = useMutation({
    mutationFn: (body: string) =>
      clientRequest('POST /v1/contacts/:personId/notes', {
        personId,
        body,
      }).then((res) => res.data),
    onSuccess: (created) => {
      setDraft('')
      setIsComposing(false)
      onCreated(created)
    },
  })

  const update = useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      clientRequest('PATCH /v1/contacts/notes/:noteId', { noteId, body }).then(
        (res) => res.data,
      ),
    onSuccess: (updated) => {
      // Only close the editor this save belongs to: note A's response landing
      // must not shut an editor the canvasser has since opened on note B.
      setEditingNoteId((current) => (current === updated.id ? null : current))
      onUpdated(updated)
    },
  })

  // Keyed by note id rather than read off the mutation, because a shared
  // mutation's `isError` and `variables` only describe its latest call — two
  // overlapping deletes would swallow the first one's failure and leave a note
  // on screen that nobody was told had failed to go.
  const [deleteErrorNoteIds, setDeleteErrorNoteIds] = useState<Set<string>>(
    new Set(),
  )
  const remove = useMutation({
    mutationFn: (noteId: string) =>
      clientRequest('DELETE /v1/contacts/notes/:noteId', { noteId }).then(
        () => noteId,
      ),
    onMutate: (noteId) => {
      setDeleteErrorNoteIds((ids) => {
        const next = new Set(ids)
        next.delete(noteId)
        return next
      })
    },
    onSuccess: onDeleted,
    onError: (_error, noteId) => {
      setDeleteErrorNoteIds((ids) => new Set(ids).add(noteId))
    },
  })

  const startCompose = () => {
    create.reset()
    // Mutually exclusive with the in-place editor: two open textareas fight
    // over focus on a phone and offer two competing Save buttons.
    setEditingNoteId(null)
    setIsComposing(true)
  }

  const cancelCompose = () => {
    create.reset()
    setDraft('')
    setIsComposing(false)
  }

  const startEdit = (note: ContactNote) => {
    update.reset()
    setIsComposing(false)
    setEditingNoteId(note.id)
    setEditingBody(note.body)
  }

  const saveEdit = () => {
    const body = editingBody.trim()
    if (!body || !editingNoteId) return
    update.mutate({ noteId: editingNoteId, body })
  }

  const saveDraft = () => {
    const body = draft.trim()
    if (!body) return
    create.mutate(body)
  }

  // Three sentences for three different claims, and they are not
  // interchangeable. A known-empty block is a fact about the resident and says
  // so. A `total` above what is on screen sends the canvasser to the CRM for
  // the rest, with the real count rather than a "3+" — ADR 0011 put the number
  // on the wire so the door could tell three-of-four from three-of-forty, which
  // is the difference between "you have the gist" and "go read the file". An
  // unknown total is a fact about the PAYLOAD — a walk snapshotted before ADR
  // 0011 shipped — and must not be worded as though it were about the person.
  //
  // No link to Contacts, deliberately: the activity feed strips its own
  // "View outreach" links for the reason a same-tab route change out of a walk
  // unmounts `WalkView` and discards the per-target replay keys that let a
  // retried knock upsert instead of duplicating. Saying where the rest are
  // costs nothing; offering to go there mid-walk does.
  const listNote =
    notes.total === null ? (
      <p className="text-muted-foreground">
        This walk was saved before notes rode the route, so only notes written
        here appear. The full record is in Contacts.
      </p>
    ) : notes.entries.length === 0 ? (
      <p className="text-muted-foreground">No notes about this resident yet.</p>
    ) : notes.total > notes.entries.length ? (
      <p className="text-muted-foreground">
        Showing the {notes.entries.length} most recent of {notes.total}. The
        rest are in Contacts.
      </p>
    ) : null

  return (
    <section className="mb-4 rounded-lg border border-border">
      <SheetSectionHeader icon={NotebookPenIcon} title="Notes" />
      <div className="flex flex-col gap-3 p-4 text-sm">
        {notes.entries.length > 0 && (
          <ul className="flex flex-col divide-y divide-border [&>li:first-child]:pt-0 [&>li:last-child]:pb-0 [&>li]:py-3">
            {notes.entries.map((note) => (
              <li key={note.id}>
                {editingNoteId === note.id ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      value={editingBody}
                      maxLength={NOTE_BODY_MAX_LENGTH}
                      disabled={update.isPending}
                      aria-label="Edit note"
                      autoFocus
                      onChange={(event) => setEditingBody(event.target.value)}
                    />
                    {update.isError && (
                      <p className="text-destructive">
                        That didn&rsquo;t save — your note is still here, try
                        again.
                      </p>
                    )}
                    <Button
                      size="small"
                      disabled={
                        update.isPending || editingBody.trim().length === 0
                      }
                      onClick={saveEdit}
                    >
                      {update.isPending ? 'Saving…' : 'Save changes'}
                    </Button>
                    <Button
                      size="small"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() => setEditingNoteId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <div className="flex items-center justify-between gap-2">
                      {/* The date product asked for is the one the note was
                          written on, and it is also the one this list is
                          ordered by — printing `updatedAt` instead would give a
                          card whose visible dates run out of order the first
                          time anybody fixes a typo. An edit says so beside it
                          rather than silently restamping the note. */}
                      <p className="text-xs text-muted-foreground">
                        {formatNoteDate(note.createdAt)}
                        {note.updatedAt !== note.createdAt && ' · edited'}
                      </p>
                      <div className="flex shrink-0 gap-1">
                        <IconButton
                          type="button"
                          variant="ghost"
                          size="small"
                          aria-label={`Edit note from ${formatNoteDate(note.createdAt)}`}
                          onClick={() => startEdit(note)}
                        >
                          <PencilIcon size={16} />
                        </IconButton>
                        {/* Confirmed, unlike every other write in this sheet.
                            A knock, a flag and an edit are all one tap to
                            reverse; a deleted note is free text nobody can
                            retype, and a thumb on a phone in the rain is
                            exactly what the confirm is for. Both other note
                            surfaces confirm, for the same reason. */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <IconButton
                              type="button"
                              variant="ghost"
                              size="small"
                              aria-label={`Delete note from ${formatNoteDate(note.createdAt)}`}
                              disabled={
                                remove.isPending && remove.variables === note.id
                              }
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2Icon size={16} />
                            </IconButton>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete this note?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This can not be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => remove.mutate(note.id)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    {deleteErrorNoteIds.has(note.id) && (
                      <p className="text-destructive">
                        That didn&rsquo;t delete — try again.
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {listNote}

        {isComposing ? (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Textarea
                value={draft}
                maxLength={NOTE_BODY_MAX_LENGTH}
                placeholder="What should the next canvasser know?"
                rows={3}
                className="pr-12"
                disabled={create.isPending}
                aria-label="Add a note"
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
              />
              <DictationMicButton
                dictation={dictation}
                idleLabel="Dictate note"
                recordingLabel="Stop dictation"
                disabled={create.isPending}
              />
            </div>
            <DictationFeedback dictation={dictation} />
            {create.isError && (
              <p className="text-destructive">
                That didn&rsquo;t save — your note is still here, try again.
              </p>
            )}
            <Button
              size="small"
              disabled={create.isPending || draft.trim().length === 0}
              onClick={saveDraft}
            >
              {create.isPending ? 'Saving…' : 'Save note'}
            </Button>
            <Button
              size="small"
              variant="outline"
              disabled={create.isPending}
              onClick={cancelCompose}
            >
              Cancel
            </Button>
          </div>
        ) : (
          // Withheld while an in-place editor is open, so the card never shows
          // two ways to save at once.
          editingNoteId === null && (
            <Button size="small" variant="outline" onClick={startCompose}>
              <NotebookPenIcon size={16} /> Add a note
            </Button>
          )
        )}
      </div>
    </section>
  )
}
