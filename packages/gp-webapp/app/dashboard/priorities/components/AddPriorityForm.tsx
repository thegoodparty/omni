'use client'

import { useState } from 'react'
import { Button, Input, Label, Textarea } from '@styleguide'
import { PlusIcon } from '@styleguide/components/ui/icons'
import type { Priority } from '@goodparty_org/contracts'
import { createPriority } from '../data/priorities-api'

export default function AddPriorityForm({
  onCreated,
}: {
  onCreated: (priority: Priority) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setTitle('')
    setDescription('')
    setError(null)
    setOpen(false)
  }

  const submit = async (): Promise<void> => {
    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()
    if (!trimmedTitle || !trimmedDescription) return
    setSaving(true)
    setError(null)
    try {
      const created = await createPriority({
        title: trimmedTitle,
        description: trimmedDescription,
      })
      onCreated(created)
      reset()
    } catch {
      setError('Could not save that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="small"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" aria-hidden />
        Add a priority
      </Button>
    )
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="priority-title" className="text-sm font-medium">
          What do you want to get done?
        </Label>
        <Input
          id="priority-title"
          value={title}
          autoFocus
          maxLength={120}
          placeholder="Fix the flooding on Oak Street"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="priority-description" className="text-sm font-medium">
          Why does it matter?
        </Label>
        <Textarea
          id="priority-description"
          value={description}
          rows={3}
          maxLength={600}
          placeholder="A sentence in your own words is plenty."
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="small"
          loading={saving}
          disabled={!title.trim() || !description.trim()}
        >
          Save it
        </Button>
        <Button
          type="button"
          size="small"
          variant="ghost"
          onClick={reset}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
