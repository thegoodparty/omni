'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { ContactNote } from 'app/dashboard/contacts/crm/shared/contacts-types'
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

// Mirrors the server-side cap (ContactNoteInputSchema.body.max(10_000)).
const NOTE_BODY_MAX_LENGTH = 10_000
const NOTE_PLACEHOLDER = 'Add a comment about this call…'

const formatNoteDate = (dateStr: string): string =>
  format(new Date(dateStr), 'MMM d, yyyy, h:mm a')

interface PhoneBankingNotesProps {
  personId: string
}

// Uses the existing person-notes API (GET/POST/PATCH/DELETE
// /v1/contacts/:personId/notes) — no phone-banking-specific endpoint. This is
// a deliberately WET, trimmed sibling of crm/person/NotesSection.tsx rather
// than a shared import: that component is gated on CRM-only concepts
// (useCrmEnabled, useWinVoterContext, Voter/Constituent Data event naming)
// that don't apply here — every person on a phone-banking list is reachable
// regardless of the CRM flag.
export default function PhoneBankingNotes({
  personId,
}: PhoneBankingNotesProps): React.JSX.Element {
  const queryClient = useQueryClient()

  const [isComposing, setIsComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')

  const notesQuery = useQuery({
    queryKey: ['contact-notes', personId],
    queryFn: () =>
      clientRequest('GET /v1/contacts/:personId/notes', { personId }).then(
        (res) => res.data.results,
      ),
  })

  const invalidateAfterWrite = () =>
    queryClient.invalidateQueries({ queryKey: ['contact-notes', personId] })

  const createMutation = useMutation({
    mutationFn: (body: string) =>
      clientRequest('POST /v1/contacts/:personId/notes', { personId, body }),
    onSuccess: () => {
      setDraft('')
      setIsComposing(false)
      invalidateAfterWrite()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      clientRequest('PATCH /v1/contacts/notes/:noteId', { noteId, body }),
    onSuccess: (_data, variables) => {
      setEditingNoteId((current) =>
        current === variables.noteId ? null : current,
      )
      invalidateAfterWrite()
    },
  })

  const [deleteErrorNoteIds, setDeleteErrorNoteIds] = useState<Set<string>>(
    new Set(),
  )
  const deleteMutation = useMutation({
    mutationFn: (noteId: string) =>
      clientRequest('DELETE /v1/contacts/notes/:noteId', { noteId }),
    onMutate: (noteId) => {
      setDeleteErrorNoteIds((ids) => {
        const next = new Set(ids)
        next.delete(noteId)
        return next
      })
    },
    onSuccess: invalidateAfterWrite,
    onError: (_error, noteId) => {
      setDeleteErrorNoteIds((ids) => new Set(ids).add(noteId))
    },
  })

  const notes = notesQuery.data ?? []

  const handleAddNote = () => {
    const body = draft.trim()
    if (!body) return
    createMutation.mutate(body)
  }

  const handleStartCompose = () => {
    createMutation.reset()
    setEditingNoteId(null)
    setIsComposing(true)
  }

  const handleCancelCompose = () => {
    createMutation.reset()
    setDraft('')
    setIsComposing(false)
  }

  const handleStartEdit = (note: ContactNote) => {
    updateMutation.reset()
    setIsComposing(false)
    setEditingNoteId(note.id)
    setEditingBody(note.body)
  }

  const handleSaveEdit = () => {
    const body = editingBody.trim()
    if (!body || !editingNoteId) return
    updateMutation.mutate({ noteId: editingNoteId, body })
  }

  return (
    <div className="flex flex-col gap-3">
      {notesQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : notesQuery.isError ? (
        <p className="text-sm text-muted-foreground">
          Unable to load notes. Please try again.
        </p>
      ) : (
        <>
          {notes.length > 0 && (
            <ul className="flex flex-col divide-y divide-border [&>li:first-child]:pt-0 [&>li:last-child]:pb-0 [&>li]:pb-4 [&>li]:pt-4">
              {notes.map((note) => (
                <li key={note.id}>
                  {editingNoteId === note.id ? (
                    <div className="flex w-full flex-col gap-2">
                      <Textarea
                        value={editingBody}
                        onChange={(e) => setEditingBody(e.target.value)}
                        maxLength={NOTE_BODY_MAX_LENGTH}
                        placeholder={NOTE_PLACEHOLDER}
                        disabled={updateMutation.isPending}
                        aria-label="Edit note body"
                        autoFocus
                      />
                      {updateMutation.isError &&
                        updateMutation.variables?.noteId === note.id && (
                          <p className="text-sm text-destructive">
                            Couldn&apos;t save your note. Please try again.
                          </p>
                        )}
                      <Button
                        type="button"
                        className="w-full"
                        onClick={handleSaveEdit}
                        disabled={
                          editingBody.trim().length === 0 ||
                          (updateMutation.isPending &&
                            updateMutation.variables?.noteId === note.id)
                        }
                        loading={
                          updateMutation.isPending &&
                          updateMutation.variables?.noteId === note.id
                        }
                      >
                        Save changes
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => setEditingNoteId(null)}
                        disabled={updateMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex w-full flex-col gap-2">
                      <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">
                          {formatNoteDate(note.updatedAt)}
                          {note.actorName ? ` · ${note.actorName}` : ''}
                        </p>
                        <div className="flex shrink-0 gap-1">
                          <IconButton
                            type="button"
                            variant="ghost"
                            size="small"
                            aria-label="Edit note"
                            onClick={() => handleStartEdit(note)}
                          >
                            <PencilIcon size={16} />
                          </IconButton>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <IconButton
                                type="button"
                                variant="ghost"
                                size="small"
                                aria-label="Delete note"
                                disabled={
                                  deleteMutation.isPending &&
                                  deleteMutation.variables === note.id
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
                                  onClick={() => deleteMutation.mutate(note.id)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                      {deleteErrorNoteIds.has(note.id) && (
                        <p className="text-sm text-destructive">
                          Couldn&apos;t delete your note. Please try again.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isComposing ? (
            <div className="flex w-full flex-col gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={NOTE_BODY_MAX_LENGTH}
                placeholder={NOTE_PLACEHOLDER}
                disabled={createMutation.isPending}
                aria-label="Add a note"
                autoFocus
              />
              {createMutation.isError && (
                <p className="text-sm text-destructive">
                  Couldn&apos;t save your note. Please try again.
                </p>
              )}
              <Button
                type="button"
                className="w-full"
                onClick={handleAddNote}
                disabled={draft.trim().length === 0 || createMutation.isPending}
                loading={createMutation.isPending}
              >
                Save note
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleCancelCompose}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          ) : editingNoteId === null ? (
            <Button
              type="button"
              className="w-full"
              onClick={handleStartCompose}
            >
              <NotebookPenIcon size={16} />
              Add a note
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}
