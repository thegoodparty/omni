'use client'

import { useState } from 'react'
import { Button, Input, Label, Textarea } from '@styleguide'
import type { Priority } from '@goodparty_org/contracts'
import { createPriority } from '../data/priorities-api'
import { PRIORITY_FORM_COPY } from '../priorityFormCopy'

const AddPriorityForm = ({
  onCreated,
  onCancel,
}: {
  onCreated: (priority: Priority) => void
  onCancel: () => void
}): React.JSX.Element => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setTitle('')
    setDescription('')
    setError(null)
    onCancel()
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
          {PRIORITY_FORM_COPY.titleLabel}
        </Label>
        <Input
          id="priority-title"
          value={title}
          autoFocus
          maxLength={PRIORITY_FORM_COPY.titleMaxLength}
          placeholder={PRIORITY_FORM_COPY.titlePlaceholder}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="priority-description" className="text-sm font-medium">
          {PRIORITY_FORM_COPY.descriptionLabel}
        </Label>
        <Textarea
          id="priority-description"
          value={description}
          rows={3}
          maxLength={PRIORITY_FORM_COPY.descriptionMaxLength}
          placeholder={PRIORITY_FORM_COPY.descriptionPlaceholder}
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

export default AddPriorityForm
