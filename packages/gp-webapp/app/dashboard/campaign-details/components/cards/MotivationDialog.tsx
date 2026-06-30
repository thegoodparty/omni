'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  CircleAlertIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@styleguide'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import {
  saveAboutFields,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { useSnackbar } from 'helpers/useSnackbar'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import {
  MIN_BIO_LENGTH,
  getBioError,
  getBioPlainLength,
} from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'

const RichEditor = dynamic(() => import('app/shared/utils/RichEditor'), {
  ssr: false,
  loading: () => (
    <div className="rounded-md border border-input bg-white px-3 py-2 text-sm text-muted-foreground">
      Loading editor…
    </div>
  ),
})

interface MotivationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialBio: string
  onSaved: (bio: string) => void
}

export default function MotivationDialog({
  open,
  onOpenChange,
  initialBio,
  onSaved,
}: MotivationDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const { errorSnackbar, successSnackbar } = useSnackbar()

  const [bio, setBio] = useState(initialBio)
  const [bioPlainLength, setBioPlainLength] = useState(
    getBioPlainLength(initialBio),
  )
  const [saving, setSaving] = useState(false)
  const [attemptedSave, setAttemptedSave] = useState(false)
  // RichEditor re-seeds whenever `initialText` changes by value, so capture the
  // editor's seed once per open to avoid clobbering in-progress edits.
  const [seed, setSeed] = useState<string | null>(null)
  const lastOpenRef = useRef(false)

  useEffect(() => {
    if (open && !lastOpenRef.current) {
      setBio(initialBio)
      setBioPlainLength(getBioPlainLength(initialBio))
      setAttemptedSave(false)
      setSeed(initialBio)
    }
    lastOpenRef.current = open
  }, [open, initialBio])

  const bioError = getBioError(bioPlainLength)

  const handleSave = async (): Promise<void> => {
    if (saving) return
    if (bioError) {
      setAttemptedSave(true)
      return
    }
    trackEvent(EVENTS.Profile.WhyRunning.ClickSave)
    setSaving(true)
    const ok = await saveAboutFields({ bio })
    if (!ok) {
      errorSnackbar('Failed to save. Please try again.')
      setSaving(false)
      return
    }
    await queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    successSnackbar('Saved')
    setSaving(false)
    onSaved(bio)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Why are you running?</DialogTitle>
          <DialogDescription>
            Reflect on your motivation for seeking office. Share personal
            experiences that have shaped your vision.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {attemptedSave && bioError && (
            <Alert
              variant="destructive"
              icon={<CircleAlertIcon />}
              className="mb-4"
            >
              <AlertDescription>{bioError}</AlertDescription>
            </Alert>
          )}
          {seed !== null && (
            <RichEditor
              initialText={seed}
              onChangeCallback={setBio}
              onTextLengthChange={setBioPlainLength}
              error={attemptedSave && !!bioError}
            />
          )}
          <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
            <span>{MIN_BIO_LENGTH} character minimum</span>
            <span>{bioPlainLength}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
