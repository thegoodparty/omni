'use client'

import { useEffect, useState } from 'react'
import { Badge, Button, Flex } from '@radix-ui/themes'
import { HiOutlineMail } from 'react-icons/hi'
import {
  ComplianceStage,
  PeerlyCvVerificationStatus,
  type ComplianceStateOutput,
} from '@goodparty_org/sdk'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { useToast } from '@/components/Toast'
import {
  getCampaignComplianceState,
  listCampaigns,
  resendCvPin,
} from '@/app/dashboard/campaigns/actions'
import { useUser } from '../context/UserContext'

const STAGE_LABELS: Record<ComplianceStage, string> = {
  [ComplianceStage.needs_profile]: 'Profile incomplete',
  [ComplianceStage.needs_filing]: 'Filing details needed',
  [ComplianceStage.pending_domain_purchase]: 'Domain purchase pending',
  [ComplianceStage.pending_website_live]: 'Website not live',
  [ComplianceStage.awaiting_pin]: 'Awaiting PIN',
  [ComplianceStage.tcr_in_review]: 'In carrier review',
  [ComplianceStage.tcr_approved]: 'Approved',
  [ComplianceStage.tcr_rejected]: 'Rejected',
}

const STAGE_BADGE_COLORS: Record<
  ComplianceStage,
  'amber' | 'green' | 'red' | 'gray'
> = {
  [ComplianceStage.needs_profile]: 'gray',
  [ComplianceStage.needs_filing]: 'gray',
  [ComplianceStage.pending_domain_purchase]: 'gray',
  [ComplianceStage.pending_website_live]: 'gray',
  [ComplianceStage.awaiting_pin]: 'amber',
  [ComplianceStage.tcr_in_review]: 'amber',
  [ComplianceStage.tcr_approved]: 'green',
  [ComplianceStage.tcr_rejected]: 'red',
}

interface ComplianceInfo {
  campaignId: number
  state: ComplianceStateOutput
}

export function CvPinStatus() {
  return (
    <ProtectedContent
      requiredPermission={PERMISSIONS.READ_CAMPAIGNS}
      hideWhenUnauthorized
    >
      <CvPinStatusContent />
    </ProtectedContent>
  )
}

function CvPinStatusContent() {
  const { id: userId } = useUser()
  const { showToast } = useToast()
  const [info, setInfo] = useState<ComplianceInfo | null>(null)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: campaigns } = await listCampaigns(userId)
        const proCampaign = campaigns.find((c) => c.isPro === true)
        if (!proCampaign) return
        const state = await getCampaignComplianceState(proCampaign.id)
        if (!cancelled) setInfo({ campaignId: proCampaign.id, state })
      } catch {
        // No campaign / no access to compliance state: show nothing rather
        // than breaking the header.
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [userId])

  if (!info) return null

  const { campaignId, state } = info
  const pinAwaitingEntry =
    state.stage === ComplianceStage.awaiting_pin &&
    state.peerlyCvStatus === PeerlyCvVerificationStatus.APPROVED

  if (!pinAwaitingEntry) {
    return (
      <Badge color={STAGE_BADGE_COLORS[state.stage]} size="2">
        10DLC: {STAGE_LABELS[state.stage]}
      </Badge>
    )
  }

  async function handleResend() {
    setResending(true)
    try {
      await resendCvPin(campaignId)
      setResent(true)
      showToast('CV PIN resent')
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to resend CV PIN'
      )
    }
    setResending(false)
  }

  return (
    <Flex gap="3" align="center">
      <Badge color="amber" size="2">
        {state.pinDelivery
          ? `PIN sent via ${state.pinDelivery.method} to ` +
            state.pinDelivery.displayString
          : 'PIN sent, not yet entered'}
      </Badge>
      <ProtectedContent
        requiredPermission={PERMISSIONS.WRITE_CAMPAIGNS}
        hideWhenUnauthorized
      >
        <Button
          variant="outline"
          onClick={handleResend}
          disabled={resending || resent}
        >
          <HiOutlineMail className="w-4 h-4" />
          {resent ? 'PIN resent' : resending ? 'Resending...' : 'Resend CV PIN'}
        </Button>
      </ProtectedContent>
    </Flex>
  )
}
