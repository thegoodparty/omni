'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type {
  OutreachDetail,
  SocialAsset,
  SocialAssetPlatform,
  SocialDraftRequest,
  SocialPurpose,
  SocialTone,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { CheckCircleIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { ALL_SOCIAL_PLATFORM_IDS } from '../socialPlatforms'
import { socialPurposeLabel } from '../socialPurposes'
import { PurposeStep } from './PurposeStep'
import { ComposeStep } from './ComposeStep'
import { PlatformsStep } from './PlatformsStep'
import { ShareStep } from './ShareStep'

type StepId = 'purpose' | 'compose' | 'platforms' | 'share'
const STEP_ORDER: StepId[] = ['purpose', 'compose', 'platforms', 'share']

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  compose: 'What do you want to say?',
  platforms: 'Where do you want to share it?',
  share: 'Your assets are ready',
}

interface SocialFlowProps {
  open: boolean
  onClose: () => void
  onSaved: (detail: OutreachDetail) => void
}

const SuccessScreen = ({
  platformCount,
  onDone,
}: {
  platformCount: number
  onDone: () => void
}) => (
  <div className="space-y-6 py-8 text-center">
    <div className="flex justify-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
        <CheckCircleIcon className="size-8 text-primary" />
      </span>
    </div>
    <div className="space-y-2">
      <h2 className="text-2xl font-semibold text-foreground">
        Your posts are ready!
      </h2>
      <p className="text-muted-foreground">
        We drafted a post for each of your {platformCount} platform
        {platformCount === 1 ? '' : 's'}. Copy the text and paste it into each
        app to publish.
      </p>
    </div>
    <Button size="large" className="w-full" onClick={onDone}>
      Done
    </Button>
  </div>
)

// Flow state is flat client state owned here (phase 1 TDD): no server
// drafts — nothing persists until Save, and reopening starts fresh.
export const SocialFlow = ({ open, onClose, onSaved }: SocialFlowProps) => {
  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<SocialPurpose | null>(null)
  const [tone, setTone] = useState<SocialTone>('warm')
  const [draft, setDraft] = useState('')
  const [manuallyEdited, setManuallyEdited] = useState(false)
  const [undoText, setUndoText] = useState<string | null>(null)
  // Last text shown under each tone this compose session (generated or
  // manually edited). Revisiting a tone restores from here; only the
  // Regenerate button forces a new call.
  const [toneDrafts, setToneDrafts] = useState<
    Partial<Record<SocialTone, string>>
  >({})
  const [platforms, setPlatforms] = useState<SocialAssetPlatform[]>(
    ALL_SOCIAL_PLATFORM_IDS,
  )
  const [assets, setAssets] = useState<SocialAsset[] | null>(null)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [saved, setSaved] = useState(false)

  // Guards against an out-of-order response (or one from a closed flow)
  // clobbering a newer draft.
  const draftRequestRef = useRef(0)

  const draftMutation = useMutation({
    mutationFn: async (input: SocialDraftRequest) => {
      const { data } = await clientRequest(
        'POST /v1/outreach/social/draft',
        input,
      )
      return data.draft
    },
  })

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data } = await clientRequest(
        'POST /v1/outreach/social/generate',
        {
          draftMessage: draft.trim(),
          purpose: purpose as SocialPurpose,
          platforms,
        },
      )
      return data
    },
    onSuccess: (data) => setAssets(data.assets),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data } = await clientRequest('POST /v1/outreach/social', {
        name: name.trim(),
        purpose: purpose as SocialPurpose,
        draftMessage: draft.trim(),
        assets: assets as SocialAsset[],
      })
      return data
    },
    onSuccess: (detail) => {
      setSaved(true)
      onSaved(detail)
    },
  })

  const { mutate: generate, reset: resetGenerate } = generateMutation
  const { reset: resetSave } = saveMutation
  const { reset: resetDraftMutation } = draftMutation

  // Fresh flow every open — a cancelled-then-reopened flow must not resume a
  // half-built campaign (reset on open, CreateListWizard convention).
  useEffect(() => {
    if (!open) return
    draftRequestRef.current += 1
    setStepId('purpose')
    setPurpose(null)
    setTone('warm')
    setDraft('')
    setManuallyEdited(false)
    setUndoText(null)
    setPlatforms(ALL_SOCIAL_PLATFORM_IDS)
    setAssets(null)
    setName('')
    setNameEdited(false)
    setSaved(false)
    resetDraftMutation()
    resetGenerate()
    resetSave()
  }, [open, resetDraftMutation, resetGenerate, resetSave])

  // Entering the share step (including Back-and-return after edits, which
  // clear `assets`) kicks off the one generate call.
  useEffect(() => {
    if (stepId !== 'share' || !open || saved) return
    if (assets !== null || generateMutation.isPending) return
    generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId, open, saved, assets])

  const stepIndex = STEP_ORDER.indexOf(stepId)

  const invalidateAssets = () => {
    setAssets(null)
    resetGenerate()
  }

  // Requests an AI draft for the given purpose/tone. On success it replaces
  // the draft; when that would clobber manually typed text, the click-time
  // text is snapshotted first so Undo can restore it — Undo never appears
  // from tone-preset-only interaction. Custom purpose is fully manual: no
  // call, ever.
  const requestDraft = (
    nextPurpose: SocialPurpose | null,
    nextTone: SocialTone,
    priorDraft: string,
    priorManuallyEdited: boolean,
  ) => {
    if (!nextPurpose || nextPurpose === 'custom') return
    const requestId = ++draftRequestRef.current
    draftMutation.mutate(
      { purpose: nextPurpose, tone: nextTone },
      {
        onSuccess: (generated) => {
          if (requestId !== draftRequestRef.current) return
          if (priorManuallyEdited) {
            setUndoText(priorDraft)
            setManuallyEdited(false)
          }
          setDraft(generated)
          setToneDrafts((prev) => ({ ...prev, [nextTone]: generated }))
          invalidateAssets()
        },
      },
    )
  }

  const handleSelectPurpose = (selected: SocialPurpose) => {
    setPurpose(selected)
    setTone('warm')
    setManuallyEdited(false)
    setUndoText(null)
    setDraft('')
    setToneDrafts({})
    invalidateAssets()
    resetDraftMutation()
    setStepId('compose')
    requestDraft(selected, 'warm', '', false)
  }

  const handleToneChange = (nextTone: SocialTone) => {
    if (nextTone === tone) return
    if (!purpose || purpose === 'custom') {
      setTone(nextTone)
      return
    }
    const remembered = toneDrafts[nextTone]
    setToneDrafts((prev) => ({ ...prev, [tone]: draft }))
    setTone(nextTone)
    if (remembered !== undefined) {
      // Supersede any in-flight call so a slow response for another tone
      // can't overwrite the restored text.
      draftRequestRef.current += 1
      resetDraftMutation()
      setDraft(remembered)
      setManuallyEdited(false)
      invalidateAssets()
      return
    }
    requestDraft(purpose, nextTone, draft, manuallyEdited)
  }

  const handleDraftChange = (value: string) => {
    setDraft(value)
    setManuallyEdited(true)
    invalidateAssets()
    // Typing supersedes a failed draft call — clear the inline error.
    if (draftMutation.isError) resetDraftMutation()
  }

  const handleUndo = () => {
    if (undoText === null) return
    setDraft(undoText)
    setUndoText(null)
    setManuallyEdited(true)
    invalidateAssets()
  }

  const handleTogglePlatform = (platform: SocialAssetPlatform) => {
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((p) => p !== platform)
        : [...current, platform],
    )
    invalidateAssets()
  }

  const handleNext = () => {
    if (stepId === 'compose') {
      setStepId('platforms')
      return
    }
    if (stepId === 'platforms') {
      if (!nameEdited && purpose) {
        setName(socialPurposeLabel(purpose))
      }
      setStepId('share')
    }
  }

  const handleBack = () => {
    const previous = STEP_ORDER[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  const dirty =
    !saved &&
    (purpose !== null ||
      draft.trim().length > 0 ||
      platforms.length !== ALL_SOCIAL_PLATFORM_IDS.length)

  const cta: FlowShellCta | null = saved
    ? null
    : stepId === 'compose'
      ? {
          label: 'Continue',
          onClick: handleNext,
          disabled: draft.trim().length === 0 || draftMutation.isPending,
        }
      : stepId === 'platforms'
        ? {
            label: 'Continue',
            onClick: handleNext,
            disabled: platforms.length === 0,
          }
        : stepId === 'share'
          ? {
              label: 'Save',
              onClick: () => saveMutation.mutate(),
              disabled:
                generateMutation.isPending ||
                generateMutation.isError ||
                assets === null ||
                assets.length === 0 ||
                name.trim().length === 0,
              loading: saveMutation.isPending,
            }
          : null

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={saved ? 'Done' : STEP_TITLES[stepId]}
      currentStep={stepIndex + 1}
      totalSteps={saved ? 0 : STEP_ORDER.length}
      onBack={!saved && stepIndex > 0 ? handleBack : undefined}
      cta={cta}
      dirty={dirty}
    >
      {saved ? (
        <SuccessScreen
          platformCount={assets?.length ?? platforms.length}
          onDone={onClose}
        />
      ) : stepId === 'purpose' ? (
        <PurposeStep selected={purpose} onSelect={handleSelectPurpose} />
      ) : stepId === 'compose' ? (
        <ComposeStep
          tone={tone}
          onToneChange={handleToneChange}
          draft={draft}
          onDraftChange={handleDraftChange}
          onRegenerate={() =>
            requestDraft(purpose, tone, draft, manuallyEdited)
          }
          isDrafting={draftMutation.isPending}
          isDraftError={draftMutation.isError}
          canUndo={undoText !== null}
          onUndo={handleUndo}
          isCustomPurpose={purpose === 'custom'}
        />
      ) : stepId === 'platforms' ? (
        <PlatformsStep selected={platforms} onToggle={handleTogglePlatform} />
      ) : (
        <ShareStep
          platforms={platforms}
          assets={assets}
          isGenerating={generateMutation.isPending}
          isError={generateMutation.isError}
          onRetry={() => generate()}
          name={name}
          onNameChange={(value) => {
            setName(value)
            setNameEdited(true)
          }}
        />
      )}
      {saveMutation.isError && !saved && (
        <p className="mt-4 text-sm text-destructive">
          We couldn&apos;t save this campaign. Try again.
        </p>
      )}
    </OutreachFlowShell>
  )
}
