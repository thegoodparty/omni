import { Alert, AlertDescription } from '@styleguide'
import { CircleAlert } from 'lucide-react'

/**
 * GoodParty.org does not back partisan (major-party) candidates or elected
 * officials. Both the Win (candidate) and Serve (elected-official) onboarding
 * party steps surface this single blocking message when a user selects Democrat
 * or Republican, and gate Continue until a non-major option is chosen. Keeping
 * the copy + alert here gives both flows one source of truth.
 */
export const MAJOR_PARTY_BLOCK_MESSAGE =
  'Sorry, GoodParty.org is only for non-partisan and independent candidates.'

/**
 * Destructive alert rendered above the party options when a major party is
 * selected, shared so the wording and styling stay identical across flows.
 */
export const MajorPartyBlockedAlert = (): React.JSX.Element => (
  <Alert variant="destructive" icon={<CircleAlert />}>
    <AlertDescription>{MAJOR_PARTY_BLOCK_MESSAGE}</AlertDescription>
  </Alert>
)
