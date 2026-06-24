import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

/**
 * Funnel events for the net-new (sales-sent magic link) elected-official
 * onboarding. "Link sent" is emitted server-side at magic-link creation time;
 * the events here cover the client-side stages (link activated, BR suggestion
 * changed, onboarding completed).
 */
export const SERVE_ONBOARDING_EVENTS = {
  SuggestionChanged: EVENTS.ServeOnboarding.BrSuggestionChanged,
  Completed: EVENTS.ServeOnboarding.NetNewCompleted,
  // Disqualification: the user picked a major party (Democrat/Republican) on the
  // party step, mirroring the Win flow's `PartyDesignationBlocked` event.
  PartyBlocked: EVENTS.ServeOnboarding.PartyDesignationBlocked,
  // Per-screen funnel stages. Each "Viewed" fires once per view; the three
  // selection screens (Office Status, Party Designation, Office) carry the
  // user's chosen card title, and the *Completed events fire on Continue.
  WelcomeViewed: EVENTS.ServeOnboarding.WelcomeViewed,
  OfficeStatusViewed: EVENTS.ServeOnboarding.OfficeStatusViewed,
  PartyDesignationViewed: EVENTS.ServeOnboarding.PartyDesignationViewed,
  OfficeViewed: EVENTS.ServeOnboarding.OfficeViewed,
  OfficeCompleted: EVENTS.ServeOnboarding.OfficeCompleted,
  ConfirmViewed: EVENTS.ServeOnboarding.ConfirmViewed,
  TermDatesViewed: EVENTS.ServeOnboarding.TermDatesViewed,
  KnowYourConstituentsViewed: EVENTS.ServeOnboarding.KnowYourConstituentsViewed,
  KnowYourConstituentsCompleted:
    EVENTS.ServeOnboarding.KnowYourConstituentsCompleted,
  PledgeViewed: EVENTS.ServeOnboarding.PledgeViewed,
  PledgeCompleted: EVENTS.ServeOnboarding.PledgeCompleted,
} as const

type ServeOnboardingEventProperties =
  | Record<string, string | number | boolean | null | undefined>
  | BrSuggestionChangedPayload

export const trackServeOnboarding = (
  name: string,
  properties?: ServeOnboardingEventProperties,
): Promise<void> => {
  // Spread into a fresh object so a typed payload (an interface, which lacks an
  // implicit index signature) is accepted by trackEvent's Record parameter.
  // Return the promise so callers can await the event before a redirect.
  return trackEvent(name, properties ? { ...properties } : undefined)
}

/**
 * Snapshot of the BallotReady-officeholder-derived prefill the lead landed on:
 * the suggested position (from the EO org's position pointer) and the term
 * dates seeded onto the elected-office record. `officeholderPositionIds` is the
 * set of BR position ids linked to Officeholder records belonging to the user;
 * the membership of the user's FINAL pick in this set is what tells us whether
 * BallotReady's suggestion was accurate. When the flow only carries the single
 * suggested position it falls back to `[positionId]`.
 */
export interface BrPrefillSnapshot {
  positionId?: string
  positionName?: string
  /** Normalized `yyyy-MM-dd`. */
  termStartDate?: string
  /** Normalized `yyyy-MM-dd`. */
  termEndDate?: string
  officeholderPositionIds?: string[]
}

/** The office/term the user ended up confirming. */
export interface SelectedOfficeSnapshot {
  positionId?: string
  positionName?: string
  /** Normalized `yyyy-MM-dd`. */
  termStartDate?: string
  /** Normalized `yyyy-MM-dd`. */
  termEndDate?: string
}

export type ServeOnboardingChangedField = 'office' | 'termDates' | 'both'

export interface BrSuggestionChangedPayload {
  electedOfficeId: string | null
  /** Whether the lead arrived with a BallotReady officeholder prefill at all. */
  hadBrPrefill: boolean
  /** Which part of the suggestion the user diverged from (null = unchanged). */
  changedField: ServeOnboardingChangedField | null
  fromPositionId: string | null
  fromPositionName: string | null
  toPositionId: string | null
  toPositionName: string | null
  fromTermStartDate: string | null
  fromTermEndDate: string | null
  toTermStartDate: string | null
  toTermEndDate: string | null
  /**
   * Whether the user's FINAL selected position is one of the Positions linked
   * to a BallotReady Officeholder record belonging to them (TDD line 61). False
   * whenever there was no BR prefill.
   */
  matchedBrOfficeholder: boolean
}

const norm = (value: string | null | undefined): string | null => value ?? null

/**
 * Builds the enriched "BR Suggestion Changed" payload by diffing the BallotReady
 * prefill against the user's final selection. Pure + null-safe so it can be unit
 * tested directly; the flow calls it at completion (where the final pick — and
 * thus `matchedBrOfficeholder` — is known) and only emits when there actually
 * was a prefill that the user changed.
 */
export const buildBrSuggestionChangedPayload = ({
  electedOfficeId,
  prefill,
  selected,
}: {
  electedOfficeId?: string
  prefill: BrPrefillSnapshot | null
  selected: SelectedOfficeSnapshot
}): BrSuggestionChangedPayload => {
  const hadBrPrefill = prefill != null

  const fromPositionId = norm(prefill?.positionId)
  const fromPositionName = norm(prefill?.positionName)
  const toPositionId = norm(selected.positionId)
  const toPositionName = norm(selected.positionName)

  const fromTermStartDate = norm(prefill?.termStartDate)
  const fromTermEndDate = norm(prefill?.termEndDate)
  const toTermStartDate = norm(selected.termStartDate)
  const toTermEndDate = norm(selected.termEndDate)

  const officeChanged =
    fromPositionId !== toPositionId ||
    // Custom offices carry no BR id on either side; fall back to the name.
    (fromPositionId === null &&
      toPositionId === null &&
      fromPositionName !== toPositionName)

  const datesChanged =
    fromTermStartDate !== toTermStartDate || fromTermEndDate !== toTermEndDate

  const changedField: ServeOnboardingChangedField | null =
    officeChanged && datesChanged
      ? 'both'
      : officeChanged
        ? 'office'
        : datesChanged
          ? 'termDates'
          : null

  const officeholderPositionIds =
    prefill?.officeholderPositionIds &&
    prefill.officeholderPositionIds.length > 0
      ? prefill.officeholderPositionIds
      : prefill?.positionId
        ? [prefill.positionId]
        : []

  const matchedBrOfficeholder =
    hadBrPrefill &&
    toPositionId !== null &&
    officeholderPositionIds.includes(toPositionId)

  return {
    electedOfficeId: norm(electedOfficeId),
    hadBrPrefill,
    changedField,
    fromPositionId,
    fromPositionName,
    toPositionId,
    toPositionName,
    fromTermStartDate,
    fromTermEndDate,
    toTermStartDate,
    toTermEndDate,
    matchedBrOfficeholder,
  }
}
