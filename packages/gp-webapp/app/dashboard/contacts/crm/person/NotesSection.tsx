'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
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
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import { InfoSection } from './InfoSection'
import type { ContactNote } from '../shared/contacts-types'

// Mirrors the server-side cap (ContactNoteInputSchema.body.max(10_000)) so the
// field can't accept input the API will reject.
const NOTE_BODY_MAX_LENGTH = 10_000

const NOTE_PLACEHOLDER = 'What do you want to remember about this contact?'

const formatNoteDate = (dateStr: string): string =>
  format(new Date(dateStr), 'MMM d, yyyy, h:mm a')

interface NotesSectionProps {
  personId: string
}

const NoteEditor: React.FC<{
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  isSaving: boolean
  isSaveError: boolean
  textareaLabel: string
}> = ({
  value,
  onChange,
  onSave,
  onCancel,
  saveLabel,
  isSaving,
  isSaveError,
  textareaLabel,
}) => (
  <div className="flex w-full flex-col gap-2">
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={NOTE_BODY_MAX_LENGTH}
      placeholder={NOTE_PLACEHOLDER}
      disabled={isSaving}
      aria-label={textareaLabel}
      autoFocus
    />
    {isSaveError ? (
      <p className="text-sm text-destructive">
        Couldn&apos;t save your note. Please try again.
      </p>
    ) : null}
    <Button
      type="button"
      className="w-full"
      onClick={onSave}
      disabled={isSaving || value.trim().length === 0}
      loading={isSaving}
    >
      {saveLabel}
    </Button>
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={onCancel}
      disabled={isSaving}
    >
      Cancel
    </Button>
  </div>
)

interface NoteRowProps {
  note: ContactNote
  isEditing: boolean
  editingBody: string
  onEditingBodyChange: (value: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  isSaving: boolean
  isSaveError: boolean
  onDelete: () => void
  isDeleting: boolean
  isDeleteError: boolean
}

const NoteRow: React.FC<NoteRowProps> = ({
  note,
  isEditing,
  editingBody,
  onEditingBodyChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  isSaving,
  isSaveError,
  onDelete,
  isDeleting,
  isDeleteError,
}) => {
  if (isEditing) {
    return (
      <NoteEditor
        value={editingBody}
        onChange={onEditingBodyChange}
        onSave={onSaveEdit}
        onCancel={onCancelEdit}
        saveLabel="Save changes"
        isSaving={isSaving}
        isSaveError={isSaveError}
        textareaLabel="Edit note body"
      />
    )
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm whitespace-pre-wrap">{note.body}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {formatNoteDate(note.updatedAt)}
        </p>
        <div className="flex gap-1 shrink-0">
          <IconButton
            type="button"
            variant="ghost"
            size="small"
            aria-label="Edit note"
            onClick={onStartEdit}
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
                disabled={isDeleting}
                className="text-destructive hover:text-destructive"
              >
                <Trash2Icon size={16} />
              </IconButton>
            </AlertDialogTrigger>
            <AlertDialogContent className="z-[2000]">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                <AlertDialogDescription>
                  This can not be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isDeleting}
                  onClick={onDelete}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {isDeleteError ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t delete your note. Please try again.
        </p>
      ) : null}
    </div>
  )
}

export default function NotesSection({
  personId,
}: NotesSectionProps): React.JSX.Element | null {
  // trackExposure=false: this surface reads the flag to decide whether to
  // render, it isn't the CRM treatment surface (ContactsPageGate is).
  const { enabled, ready } = useCrmEnabled()
  const orgSlug = useOrganization()?.slug
  const { isWin, isReady: isWinContextReady } = useWinVoterContext()
  const queryClient = useQueryClient()

  const [isComposing, setIsComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')

  const shouldRender = ready && enabled

  const notesQuery = useQuery({
    // API returns notes ordered newest-first (ContactNoteService.listForPerson
    // orders by createdAt desc) — no client-side re-sort needed.
    queryKey: ['contact-notes', orgSlug, personId],
    queryFn: () =>
      clientRequest('GET /v1/contacts/:personId/notes', { personId }).then(
        (res) => res.data.results,
      ),
    // !!orgSlug: before the org resolves, a fetch would land under an
    // undefined-slug cache key that post-write invalidations never hit.
    enabled: shouldRender && !!orgSlug,
  })

  const invalidateAfterWrite = () => {
    queryClient.invalidateQueries({
      queryKey: ['contact-notes', orgSlug, personId],
    })
  }

  const createMutation = useMutation({
    mutationFn: (body: string) =>
      clientRequest('POST /v1/contacts/:personId/notes', {
        personId,
        body,
      }),
    onSuccess: () => {
      setDraft('')
      setIsComposing(false)
      invalidateAfterWrite()
      if (isWinContextReady) {
        trackEvent(
          isWin ? EVENTS.VoterData.NoteAdded : EVENTS.ConstituentData.NoteAdded,
        )
      }
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      clientRequest('PATCH /v1/contacts/notes/:noteId', { noteId, body }),
    onSuccess: (_data, variables) => {
      // Only close the editor the completed save belongs to — note A's
      // in-flight response must not close an editor since opened on note B.
      setEditingNoteId((current) =>
        current === variables.noteId ? null : current,
      )
      invalidateAfterWrite()
    },
  })

  // Keyed by note id: a shared mutation's isError/variables only reflect the
  // latest call, which would swallow an earlier delete's failure when two
  // deletes overlap.
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

  if (!shouldRender) return null

  const notes = notesQuery.data ?? []

  const handleAddNote = () => {
    const body = draft.trim()
    if (!body) return
    createMutation.mutate(body)
  }

  const handleStartCompose = () => {
    createMutation.reset()
    // Mutually exclusive with the in-place editor — two open editors would
    // fight over focus and offer competing save paths.
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
    <InfoSection title="Notes" icon={<NotebookPenIcon size={24} />}>
      {notesQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : notesQuery.isError ? (
        <p className="text-sm text-muted-foreground">
          Unable to load notes. Please try again.
        </p>
      ) : (
        <>
          {notes.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border [&>li]:pt-4 [&>li:first-child]:pt-0 [&>li]:pb-4 [&>li:last-child]:pb-0">
              {notes.map((note) => (
                <li key={note.id}>
                  <NoteRow
                    note={note}
                    isEditing={editingNoteId === note.id}
                    editingBody={editingBody}
                    onEditingBodyChange={setEditingBody}
                    onStartEdit={() => handleStartEdit(note)}
                    onCancelEdit={() => setEditingNoteId(null)}
                    onSaveEdit={handleSaveEdit}
                    isSaving={
                      updateMutation.isPending &&
                      updateMutation.variables?.noteId === note.id
                    }
                    isSaveError={
                      updateMutation.isError &&
                      updateMutation.variables?.noteId === note.id
                    }
                    onDelete={() => deleteMutation.mutate(note.id)}
                    isDeleting={
                      deleteMutation.isPending &&
                      deleteMutation.variables === note.id
                    }
                    isDeleteError={deleteErrorNoteIds.has(note.id)}
                  />
                </li>
              ))}
            </ul>
          ) : null}

          {isComposing ? (
            <NoteEditor
              value={draft}
              onChange={setDraft}
              onSave={handleAddNote}
              onCancel={handleCancelCompose}
              saveLabel="Save note"
              isSaving={createMutation.isPending}
              isSaveError={createMutation.isError}
              textareaLabel="Add a note"
            />
          ) : (
            <Button
              type="button"
              className="w-full"
              onClick={handleStartCompose}
            >
              <NotebookPenIcon size={16} />
              Add a note
            </Button>
          )}
        </>
      )}
    </InfoSection>
  )
}
