'use client'

import { useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { User } from 'helpers/types'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@styleguide'

interface EditNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  firstName: string
  lastName: string
}

export const EditNameDialog = ({
  open,
  onOpenChange,
  firstName: initialFirstName,
  lastName: initialLastName,
}: EditNameDialogProps): React.JSX.Element => {
  const [, setUser] = useUser()
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = firstName.trim() !== '' && lastName.trim() !== '' && !saving

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const resp = await clientFetch<User>(apiRoutes.user.updateUser, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      })
      if (resp.ok && resp.data?.id) {
        setUser(resp.data)
        onOpenChange(false)
        return
      }
      setError('We could not save your name. Please try again.')
    } catch {
      setError('We could not save your name. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setFirstName(initialFirstName)
          setLastName(initialLastName)
          setError(null)
        }
        if (!saving) onOpenChange(next)
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit your name</DialogTitle>
            <DialogDescription>
              This is the name shown across GoodParty.org.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-first-name">First name</Label>
            <Input
              id="edit-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-last-name">Last name</Label>
            <Input
              id="edit-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
