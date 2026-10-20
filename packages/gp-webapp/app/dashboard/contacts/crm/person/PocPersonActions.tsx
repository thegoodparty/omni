'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import type { Person } from '../shared/contacts-types'

const formatMs = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`

const editableFields = (person: Person) => [
  { field: 'FirstName', label: 'First name', value: person.firstName },
  { field: 'LastName', label: 'Last name', value: person.lastName },
  {
    field: 'Residence_Addresses_AddressLine',
    label: 'Street address',
    value: person.address.line1,
  },
  {
    field: 'Residence_Addresses_City',
    label: 'City',
    value: person.address.city,
  },
  { field: 'Residence_Addresses_Zip', label: 'ZIP', value: person.address.zip },
  {
    field: 'VoterTelephones_CellPhoneFormatted',
    label: 'Cell phone',
    value: person.cellPhone,
  },
  {
    field: 'VoterTelephones_LandlineFormatted',
    label: 'Landline',
    value: person.landline,
  },
  { field: 'email', label: 'Email', value: person.pocEmail ?? null },
]

const EditableField = ({
  personId,
  field,
  label,
  value,
  onSaved,
}: {
  personId: string
  field: string
  label: string
  value: string | null
  onSaved: (ms: number) => Promise<void>
}) => {
  const [draft, setDraft] = useState(value ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const { errorSnackbar } = useSnackbar()
  const changed = draft.trim() !== (value ?? '')

  const save = async () => {
    setIsSaving(true)
    const startedAt = performance.now()
    try {
      await clientRequest('PATCH /v1/poc/contacts/:personId/field', {
        personId,
        field,
        value: draft.trim() === '' ? null : draft.trim(),
      })
      await onSaved(Math.round(performance.now() - startedAt))
    } catch {
      errorSnackbar(`Couldn't save ${label.toLowerCase()}. Try again.`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-1 flex-col gap-1 text-sm text-muted-foreground">
        {label}
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <Button
        variant="outline"
        disabled={!changed}
        loading={isSaving}
        onClick={save}
      >
        Save
      </Button>
    </div>
  )
}

export const PocPersonActions = ({
  person,
  onRemoved,
}: {
  person: Person
  onRemoved: (personId: string) => void
}) => {
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const [isEditing, setIsEditing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [lastWrite, setLastWrite] = useState<string | null>(null)

  const refetchPerson = async (label: string, writeMs: number) => {
    const startedAt = performance.now()
    await queryClient.invalidateQueries({
      queryKey: ['person', orgSlug, person.id],
    })
    queryClient.invalidateQueries({ queryKey: ['contacts'] })
    queryClient.invalidateQueries({ queryKey: ['contacts-typeahead'] })
    setLastWrite(
      `${label} took ${formatMs(writeMs)}, reload took ${formatMs(
        Math.round(performance.now() - startedAt),
      )}`,
    )
  }

  const remove = async () => {
    setIsRemoving(true)
    try {
      await clientRequest('POST /v1/poc/contacts/:personId/remove', {
        personId: person.id,
      })
      setConfirmOpen(false)
      onRemoved(person.id)
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      queryClient.invalidateQueries({ queryKey: ['contacts-stats'] })
      queryClient.invalidateQueries({ queryKey: ['contacts-typeahead'] })
    } catch {
      errorSnackbar("Couldn't remove this person. Try again.")
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setIsEditing((v) => !v)}>
          {isEditing ? 'Done editing' : 'Edit'}
        </Button>
        <Button variant="outline" onClick={() => setConfirmOpen(true)}>
          Remove
        </Button>
      </div>
      {lastWrite && (
        <p className="text-xs text-muted-foreground">{lastWrite}</p>
      )}
      {isEditing && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          {editableFields(person).map((f) => (
            <EditableField
              key={`${f.field}-${f.value ?? ''}`}
              personId={person.id}
              field={f.field}
              label={f.label}
              value={f.value}
              onSaved={(ms) => refetchPerson(`Saving ${f.label}`, ms)}
            />
          ))}
        </div>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="z-[2000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this person?</AlertDialogTitle>
            <AlertDialogDescription>
              They won&apos;t show up in your contacts. You can bring them back
              from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isRemoving}
              onClick={(e) => {
                e.preventDefault()
                remove()
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const PocRemovedPerson = ({
  personId,
  onRestored,
}: {
  personId: string
  onRestored: () => void
}) => {
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const [isRestoring, setIsRestoring] = useState(false)

  const restore = async () => {
    setIsRestoring(true)
    try {
      await clientRequest('POST /v1/poc/contacts/:personId/restore', {
        personId,
      })
      onRestored()
      queryClient.invalidateQueries({ queryKey: ['person', orgSlug, personId] })
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      queryClient.invalidateQueries({ queryKey: ['contacts-stats'] })
      queryClient.invalidateQueries({ queryKey: ['contacts-typeahead'] })
    } catch {
      errorSnackbar("Couldn't bring this person back. Try again.")
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-4 pt-4">
      <h2 className="text-2xl font-semibold">Removed</h2>
      <p className="text-sm text-muted-foreground">
        This person no longer shows up in your contacts.
      </p>
      <Button variant="outline" loading={isRestoring} onClick={restore}>
        Restore
      </Button>
    </div>
  )
}
