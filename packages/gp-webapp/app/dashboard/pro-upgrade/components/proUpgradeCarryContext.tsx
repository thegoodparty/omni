'use client'

import { createContext, useContext } from 'react'
import { noop } from '@shared/utils/noop'
import {
  EMPTY_PRO_UPGRADE_CARRY,
  type ProUpgradeCarry,
} from '../proUpgradePlanParams'

export interface ProUpgradeCarryContextValue extends ProUpgradeCarry {
  markFromPro: () => void
}

// Its own context, not part of the wizard's: the embedded flow in the
// outreach sheet has no URL to carry anything on, and reads the empty default.
export const ProUpgradeCarryContext =
  createContext<ProUpgradeCarryContextValue>({
    ...EMPTY_PRO_UPGRADE_CARRY,
    markFromPro: noop,
  })

export const useProUpgradeCarry = (): ProUpgradeCarryContextValue =>
  useContext(ProUpgradeCarryContext)
