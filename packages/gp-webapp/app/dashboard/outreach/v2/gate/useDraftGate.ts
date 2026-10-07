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
}

export interface DraftGate {
  savedDraft: OutreachDetail | null
  resumed: boolean
  gateOpen: boolean
  gateOrigin: GateOrigin
  // The label of the button that opened the gate, for the Pro wizard's
  // `Flow Started`.
  gateCta: string | undefined
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
    setExplainerOpen(false)
  }, [open, resumeDraft])

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
  useEffect(() => {
    if (open && resumed && gate.requirement !== null) {
      setGateOpen(true)
      setGateOrigin('resume')
      setGateCta(resumeCta)
    }
  }, [open, resumed, gate.requirement, resumeCta])

  // Build mode's one write: the draft the candidate comes back to. A 409
  // means they already have one, so the flow switches to that row instead of
  // reporting a failure they can do nothing about.
  const saveDraft = async (cta?: string): Promise<void> => {
    if (savingDraft) return
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
      onCampaignCreated?.(draft)
      setSavedDraft(draft)
      setGateOrigin('save')
      setGateCta(cta)
      setGateOpen(true)
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
        setGateOpen(true)
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
    const origin = gateOrigin
    setGateOrigin(null)
    if (origin === 'explainer' && savedDraft === null) return
    setResumed(true)
    goToResumeStep()
  }

  // Leaving the gate. With a draft behind it, "Finish later" means what it
  // always did: the row is safe in history and the sheet closes. With
  // nothing saved there is nothing to come back to, so leaving the gate can
  // only mean returning to the step the candidate was building — which is
  // also what Back on the upgrade wizard's first step calls.
  const handleGateExit = (): void => {
    setGateOpen(false)
    const origin = gateOrigin
    setGateOrigin(null)
    if (origin === 'explainer' || savedDraft === null) return
    onClose()
  }

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
