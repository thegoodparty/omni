import type { ComponentType } from 'react'
import { PRO_UPGRADE_STEP, type ProUpgradeStep } from '../proUpgradeStep'
import ValuePropStep from './ValuePropStep'
import FilingStatusStep from './FilingStatusStep'
import FilingInstructionsStep from './FilingInstructionsStep'
import GuidanceStep from './GuidanceStep'
import InterstitialStep from './InterstitialStep'
import EinStep from './EinStep'
import FilingDetailsStep from './FilingDetailsStep'
import CandidateProfileStep from './CandidateProfileStep'
import PaymentStep from './PaymentStep'
import SuccessStep from './SuccessStep'

// The route pages each import one of these directly; the embeddable flow
// renders them by step id so both shells show the same screens.
export const PRO_UPGRADE_STEP_COMPONENTS: Record<
  ProUpgradeStep,
  ComponentType
> = {
  [PRO_UPGRADE_STEP.VALUE_PROP]: ValuePropStep,
  [PRO_UPGRADE_STEP.STATUS]: FilingStatusStep,
  [PRO_UPGRADE_STEP.FILING_INSTRUCTIONS]: FilingInstructionsStep,
  [PRO_UPGRADE_STEP.GUIDANCE]: GuidanceStep,
  [PRO_UPGRADE_STEP.EIN]: EinStep,
  [PRO_UPGRADE_STEP.FILING_DETAILS]: FilingDetailsStep,
  [PRO_UPGRADE_STEP.CANDIDATE_PROFILE]: CandidateProfileStep,
  [PRO_UPGRADE_STEP.PAYMENT]: PaymentStep,
  [PRO_UPGRADE_STEP.SUCCESS]: SuccessStep,
  [PRO_UPGRADE_STEP.INTERSTITIAL]: InterstitialStep,
}
