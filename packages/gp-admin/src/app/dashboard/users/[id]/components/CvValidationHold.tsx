'use client'

import { useState } from 'react'
import { Button, Checkbox, Flex, Link, Text } from '@radix-ui/themes'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { useCvHoldOverride } from '@/app/dashboard/campaigns/components/useCvHoldOverride'
import { EditFilingUrlAction } from '@/app/dashboard/campaigns/components/EditFilingUrlAction'

interface CvValidationHoldProps {
  campaignId: number
  filingUrl: string | null
  failureReasons: string[]
  onResolved: () => Promise<void>
}

export function CvValidationHold({
  campaignId,
  filingUrl,
  failureReasons,
  onResolved,
}: CvValidationHoldProps) {
  const [confirmed, setConfirmed] = useState(false)
  // overridden keeps the button dead between a successful override and the
  // onResolved refresh unmounting this widget — a second click in that gap
  // would queue (and bill) another agent run.
  const { override, overriding, overridden } = useCvHoldOverride(
    campaignId,
    onResolved
  )

  return (
    <Flex direction="column" gap="2">
      {failureReasons.length > 0 && (
        <Flex direction="column" gap="1">
          {failureReasons.map((reason) => (
            <Text size="2" color="gray" key={reason}>
              • {reason}
            </Text>
          ))}
        </Flex>
      )}
      {filingUrl && (
        <Flex align="center" gap="2">
          <Link size="2" href={filingUrl} target="_blank" rel="noreferrer">
            Open the filing page
          </Link>
          <ProtectedContent
            requiredPermission={PERMISSIONS.WRITE_CAMPAIGNS}
            hideWhenUnauthorized
          >
            <EditFilingUrlAction
              campaignId={campaignId}
              filingUrl={filingUrl}
              onResolved={onResolved}
            />
          </ProtectedContent>
        </Flex>
      )}
      <ProtectedContent
        requiredPermission={PERMISSIONS.WRITE_CAMPAIGNS}
        hideWhenUnauthorized
      >
        <Flex direction="column" gap="2" align="start">
          <Flex align="center" gap="2">
            <Checkbox
              checked={confirmed}
              disabled={overriding || overridden}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
            />
            <Text size="2" color="gray">
              I opened the filing page and verified this candidate&apos;s filing
            </Text>
          </Flex>
          <Button
            variant="outline"
            disabled={!confirmed || overriding || overridden}
            onClick={override}
          >
            {overridden
              ? 'Hold cleared'
              : overriding
                ? 'Resubmitting...'
                : 'Override validation and resubmit'}
          </Button>
        </Flex>
      </ProtectedContent>
    </Flex>
  )
}
