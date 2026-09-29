'use client'

import { createContext, useContext } from 'react'
import { noop } from '@shared/utils/noop'
import type { ProUpgradeStep } from '../proUpgradeStep'

export type ProUpgradeLaunchChannel = 'sms' | 'robocall' | 'door' | 'phone-bank'

export interface ProUpgradeWizardContextValue {
  // null on the wizard index (before redirect) or on any non-step path.
  currentStep: ProUpgradeStep | null
  // outreach-pro-gating-v2: filing details and profile are collected after
  // payment, in campaign verification.
  purchaseOnly: boolean
  // Set when the flow was launched from an outreach channel (milestone 2);
  // drives the interstitial and success copy. null on the standalone page.
  channel: ProUpgradeLaunchChannel | null
  goToStep: (step: ProUpgradeStep) => void
  goToNextStep: () => void
  goToPreviousStep: () => void
  exit: () => void
  complete: () => void
}

export const ProUpgradeWizardContext =
  createContext<ProUpgradeWizardContextValue>({
    currentStep: null,
    purchaseOnly: false,
    channel: null,
    goToStep: noop,
    goToNextStep: noop,
    goToPreviousStep: noop,
    exit: noop,
    complete: noop,
  })

// Per-step pages (tasks 06–14) read this to drive their own forward CTAs and
// to know which step is active. Both shells provide it: the route-based
// ProUpgradeWizard and the embeddable ProUpgradeFlow.
export const useProUpgradeWizard = (): ProUpgradeWizardContextValue =>
  useContext(ProUpgradeWizardContext)
