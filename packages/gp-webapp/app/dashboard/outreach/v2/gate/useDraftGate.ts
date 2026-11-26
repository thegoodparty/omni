'use client'

import { useCallback, useEffect, useState } from 'react'
import type { OutreachDetail } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import type { CreateOutreachDraftResult } from 'helpers/createOutreachDraft'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { EXPLAINER_COPY, type GateChannel } from './gateCopy'
import type { OutreachGateState } from './useOutreachGate'

// Only the two channels that save a row reach this hook; phone banking and
// door knocking gate a single paid write and own their own origin state.
export type DraftGateChannel = Extract<GateChannel, 'sms' | 'robocall'>

// WHICH gesture opened the gate, and so what finishing it means. Without
// this the flow could only assume a completion was the end of a save, and
// the banner's own "Upgrade to Pro" — reachable from every build-mode step —
// landed the candidate on the schedule step of a draft that was never
// written, throwing away purpose, audience, message and recording.
export type GateOrigin = 'save' | 'resume' | 'explainer' | null

interface UseDraftGateParams {
  channel: DraftGateChannel
  gate: OutreachGateState
  // The flow's sheet visibility: everything here resets with it.
  open: boolean
  resumeDraft: OutreachDetail | null
  // The channel's own write, guards and payload included. `null` means the
  // flow is not ready to save and nothing was attempted.
  createDraft: () => Promise<CreateOutreachDraftResult | null>
  // Where a resumed row starts — the schedule step in both flows.
  goToResumeStep: () => void
  // History refetch after a draft is written or discarded.
  onDraftSaved: () => Promise<void>
  // The channel's `Outreach - Campaign Created` payload, fired here
  // because a gated candidate's campaign is created by THIS save and never
  // reaches the review step that reports it for a Pro one. The flow supplies
  // it: only the flow knows its audience and its send date.
  onCampaignCreated?: (draft: OutreachDetail) => void
  onClose: () => void
  // The label of the button that resumed the draft, when one did (the draft
  // drawer's footer). A tile or deep link resume has none.
  resumeCta?: string
  // Flag on (win_per_campaign_pricing): a free candidate's draft save opens
  // the Pro pitch as a dialog over the step they pressed it on, not as the
  // wizard's inline interstitial in place of it.
  pitchAsDialog?: boolean
  // Reopening a saved draft that needs Pro puts the pitch dialog over the
  // flow's step, as a fresh save does, instead of the wizard in place of the
  // step. The flow has to render a step for the dialog to sit over.
  pitchOnResume?: boolean
  // The draft drawer's "Upgrade to Pro" already made the pitch, so that
  // resume opens the wizard itself.
  resumeStartsOnWizard?: boolean
  // The channel's draft write updates the saved row when it is pressed again
  // (a chat card's keyed text). Without it a second press would meet the
  // channel's one-draft cap, so the hook reopens the pitch for the row it has.
  savesInPlace?: boolean
}

export interface DraftGate {
  savedDraft: OutreachDetail | null
  resumed: boolean
  gateOpen: boolean
  gateOrigin: GateOrigin
  // The label of the button that opened the gate, for the Pro wizard's
  // `Flow Started`.
  gateCta: string | undefined
  // The Pro pitch dialog is up over the flow's step (`pitchAsDialog` only).
  pitchOpen: boolean
  // "Join Pro" on that dialog: the wizard takes the step's place.
  joinPitch: () => void
  // Back off the wizard's first step returns to the pitch when the gate was
  // reached through it. Unset otherwise, so the wizard falls back to its own
  // interstitial as it always has.
  wizardBack: (() => void) | undefined
  explainerOpen: boolean
  setExplainerOpen: (open: boolean) => void
  savingDraft: boolean
  draftSaveError: boolean
  saveDraft: (cta?: string) => Promise<void>
  handleGateComplete: () => void
  handleGateExit: () => void
  openGateFromExplainer: () => void
}

// The gate plumbing SmsFlow and RobocallFlow both need: the saved row, the
// resume switch, the gate/explainer visibility, the origin that says what a
// completion means, and the save and completion with their analytics (a
// draft is deleted from its history row's drawer, not from the gate). The channel-specific parts — payload assembly, step ids, phone
// list derivation — stay in the flows behind `createDraft`/`goToResumeStep`.
export const useDraftGate = ({
  channel,
  gate,
  open,
  resumeDraft,
  createDraft,
  goToResumeStep,
  onDraftSaved,
  onCampaignCreated,
  onClose,
  resumeCta,
  pitchAsDialog = false,
  pitchOnResume = false,
  resumeStartsOnWizard = false,
  savesInPlace = false,
}: UseDraftGateParams): DraftGate => {
  // The saved draft row this flow is working against: the one the hub
  // resumed, the one a 409 says already exists, or the one just written.
  const [savedDraft, setSavedDraft] = useState<OutreachDetail | null>(
    resumeDraft,
  )
  // Whether the flow is running off that row (seeded and scheduling it)
  // rather than still building one.
  const [resumed, setResumed] = useState(Boolean(resumeDraft))
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftSaveError, setDraftSaveError] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)
  const [gateOrigin, setGateOrigin] = useState<GateOrigin>(null)
  const [gateCta, setGateCta] = useState<string | undefined>(undefined)
  const [pitchOpen, setPitchOpen] = useState(false)
  // The wizard was reached through the pitch dialog, so Back off its first
  // step has a pitch to return to.
  const [viaPitch, setViaPitch] = useState(false)
  const [explainerOpen, setExplainerOpen] = useState(false)

  // Reopening starts fresh, exactly as the rest of the flow state does.
  useEffect(() => {
    if (!open) return
    setSavedDraft(resumeDraft)
    setResumed(Boolean(resumeDraft))
    setSavingDraft(false)
    setDraftSaveError(false)
    setGateOpen(false)
    setGateOrigin(null)
    setGateCta(undefined)
    setPitchOpen(false)
    setViaPitch(false)
    setExplainerOpen(false)
  }, [open, resumeDraft])

  // A free candidate's Pro pitch is a dialog over the flow's step; every
  // other requirement is a screen that stands in for it.
  const proPitchGate = pitchAsDialog && gate.requirement === 'pro'

  // The gate screens stand in for a resumed flow until the candidate can
  // send. Open-only: the requirement clears the moment payment lands, while
  // the upgrade's own success screen is still up, so closing the gate here
  // would take that screen away before the candidate could press Continue —
  // and Continue is what calls handleGateComplete. The gate closes through
  // onExit or onComplete, never through a requirement change.
  //
  // Keyed on `open` as well: the flow stays mounted between opens, so a
  // second open of the same draft found `resumed` already true and this
  // never re-ran — the reset above had just closed the gate, and the
  // candidate landed on the schedule step of a text they cannot send.
  //
  // Not for closed texting: the flow shows the cutoff notice instead, and
  // there is no gate screen to finish.
  useEffect(() => {
    if (
      open &&
      resumed &&
      gate.requirement !== null &&
      gate.requirement !== 'closed'
    ) {
      setGateOrigin('resume')
      setGateCta(resumeCta)
      if (proPitchGate && pitchOnResume && !resumeStartsOnWizard) {
        setPitchOpen(true)
      } else {
        setGateOpen(true)
      }
    }
  }, [
    open,
    resumed,
    gate.requirement,
    resumeCta,
    proPitchGate,
    pitchOnResume,
    resumeStartsOnWizard,
  ])

  // Build mode's one write: the draft the candidate comes back to. A 409
  // means they already have one, so the flow switches to that row instead of
  // reporting a failure they can do nothing about.
  const saveDraft = async (cta?: string): Promise<void> => {
    if (savingDraft) return
    // Closing the pitch left the candidate on the step with the row saved, so
    // pressing the button again opens the pitch for that row. Writing again
    // would only meet the one-draft cap.
    if (savedDraft !== null && proPitchGate && !savesInPlace) {
      setGateOrigin('save')
      setGateCta(cta)
      setPitchOpen(true)
      return
    }
    setSavingDraft(true)
    setDraftSaveError(false)
    const result = await createDraft()
    if (result === null) {
      setSavingDraft(false)
      return
    }
    const { draft, conflictId } = result
    if (draft) {
      trackEvent(EVENTS.Outreach.Draft.Saved, { channel })
      // The campaign now exists and has reached nobody — which is exactly
      // what Campaign Created reports. Fired once, here, for a gated
      // candidate; the Pro path reports it off the pending_payment draft
      // instead, and a resume of THIS row must not report it a second time.
      // Nor must a card's draft saved again, which updates the row in place.
      if (draft.id !== savedDraft?.id) onCampaignCreated?.(draft)
      setSavedDraft(draft)
      setGateOrigin('save')
      setGateCta(cta)
      // Only the free tier's pitch is a dialog; a Pro candidate who still has
      // to verify goes straight to the verification screens.
      if (proPitchGate) setPitchOpen(true)
      else setGateOpen(true)
      setSavingDraft(false)
      // The row exists once the 201 lands; a failed history refetch here is
      // not a failed save, and the hub refetches again when the sheet closes.
      await onDraftSaved().catch(() => undefined)
      return
    }
    if (conflictId !== null) {
      try {
        const { data } = await clientRequest('GET /v1/outreach/:id', {
          id: String(conflictId),
        })
        setSavedDraft(data)
        setResumed(true)
        setGateOrigin('resume')
        setGateCta(cta)
        // The existing row has no send date, so the flow has to land where
        // a resume starts. Leaving it on review would put it one enabled
        // button away from checkout the moment the gate steps aside.
        goToResumeStep()
        if (proPitchGate && pitchOnResume) setPitchOpen(true)
        else setGateOpen(true)
        return
      } catch {
        setDraftSaveError(true)
        return
      } finally {
        setSavingDraft(false)
      }
    }
    setSavingDraft(false)
    setDraftSaveError(true)
  }

  // Finishing the gate means whatever the gesture that opened it was about.
  // A save or a resume hands the flow the row it can now schedule; the
  // banner's explainer with nothing saved hands the candidate back the step
  // they were on, with everything they had typed still in it.
  const handleGateComplete = (): void => {
    setGateOpen(false)
    setViaPitch(false)
    const origin = gateOrigin
    setGateOrigin(null)
    if (origin === 'explainer' && savedDraft === null) return
    setResumed(true)
    goToResumeStep()
  }

  // Leaving the gate. A Pro pitch the flow put over a step closes with that
  // dialog alone: the candidate is back on the step they were on, with the
  // draft saved and everything they typed still there. A gate screen that
  // stood in for the step has nothing to go back to: with a draft behind it,
  // "Finish later" means the row is safe in history and the sheet closes, and
  // with nothing saved it can only mean returning to the step the candidate
  // was building — which is also what Back on the upgrade wizard's first step
  // calls.
  const handleGateExit = (): void => {
    const stepStaysUp =
      proPitchGate &&
      (gateOrigin === 'save' || (gateOrigin === 'resume' && pitchOnResume))
    setGateOpen(false)
    setPitchOpen(false)
    setViaPitch(false)
    const origin = gateOrigin
    setGateOrigin(null)
    if (origin === 'explainer' || savedDraft === null) return
    if (stepStaysUp) return
    onClose()
  }

  const joinPitch = useCallback((): void => {
    setPitchOpen(false)
    setGateOpen(true)
    setViaPitch(true)
  }, [])

  const backToPitch = useCallback((): void => {
    setGateOpen(false)
    setPitchOpen(true)
  }, [])

  // Only a Pro explainer's CTA reaches the wizard, so its label is the one
  // Flow Started can report.
  const openGateFromExplainer = useCallback((): void => {
    setGateOrigin('explainer')
    setGateCta(EXPLAINER_COPY.ctaJoin)
    setGateOpen(true)
  }, [])

  return {
    savedDraft,
    resumed,
    gateOpen,
    gateOrigin,
    gateCta,
    pitchOpen,
    joinPitch,
    wizardBack: viaPitch ? backToPitch : undefined,
    explainerOpen,
    setExplainerOpen,
    savingDraft,
    draftSaveError,
    saveDraft,
    handleGateComplete,
    handleGateExit,
    openGateFromExplainer,
  }
}
