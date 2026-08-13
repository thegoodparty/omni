'use client'

import { useEffect, useState } from 'react'
import { Badge, Button, Checkbox, Flex, Text } from '@radix-ui/themes'
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
  setInternalTestingApproval,
} from '@/app/dashboard/campaigns/actions'
import { useUser } from '../context/UserContext'

// Mirrors gp-api's INTERNAL_EMAIL_SUFFIXES (users.util.ts) — the grant
// endpoint enforces this server-side; the UI check only hides the checkbox
// for accounts that would be rejected anyway.
const INTERNAL_EMAIL_SUFFIXES = ['@goodparty.org', '@test.goodparty.org']

const isInternalEmail = (email: string) =>
  INTERNAL_EMAIL_SUFFIXES.some((suffix) => email.toLowerCase().endsWith(suffix))

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
  const { id: userId, email } = useUser()
  const { showToast } = useToast()
  const [info, setInfo] = useState<ComplianceInfo | null>(null)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [savingApproval, setSavingApproval] = useState(false)

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

  const testingApproved = state.internalTestingApprovedAt !== null
  // A record created by the real compliance flow must never be overwritten
  // or deleted from here — the endpoints refuse it, so disable the toggle.
  const hasRealComplianceRecord = state.hasComplianceRecord && !testingApproved

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

  async function handleApprovalToggle(checked: boolean) {
    setSavingApproval(true)
    try {
      await setInternalTestingApproval(campaignId, checked)
      const refreshed = await getCampaignComplianceState(campaignId)
      setInfo({ campaignId, state: refreshed })
      showToast(
        checked
          ? 'Marked as 10DLC approved for internal testing'
          : 'Internal testing approval removed'
      )
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'Failed to update internal testing approval'
      )
    }
    setSavingApproval(false)
  }

  const internalTestingToggle = isInternalEmail(email) && (
    <ProtectedContent
      requiredPermission={PERMISSIONS.WRITE_CAMPAIGNS}
      hideWhenUnauthorized
    >
      <Flex
        align="center"
        gap="2"
        title={
          hasRealComplianceRecord
            ? 'Unavailable: this campaign has a real 10DLC compliance record'
            : 'Internal accounts only. Unlocks texting UI for testing; ' +
              'real sends stay blocked (no Peerly identity is created).'
        }
      >
        <Checkbox
          checked={testingApproved}
          disabled={savingApproval || hasRealComplianceRecord}
          onCheckedChange={(checked) => handleApprovalToggle(checked === true)}
        />
        <Text size="2" color="gray">
          10DLC approved (internal testing)
        </Text>
      </Flex>
    </ProtectedContent>
  )

  if (!pinAwaitingEntry) {
    return (
      <Flex gap="3" align="center">
        <Badge color={STAGE_BADGE_COLORS[state.stage]} size="2">
          10DLC: {STAGE_LABELS[state.stage]}
        </Badge>
        {internalTestingToggle}
      </Flex>
    )
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
