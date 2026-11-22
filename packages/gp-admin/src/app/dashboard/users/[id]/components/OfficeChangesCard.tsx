'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { resetOfficeChanges } from '@/app/dashboard/organizations/actions'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

interface OfficeChangesCardProps {
  organizationSlug: string
  userId: number
  officeChangeCount: number
  officeChangeLimit: number
}

// The owner can re-pick their office (or district) this many times before
// gp-api refuses, because the voter file follows the office. Reset gives them
// the full allowance back.
export function OfficeChangesCard({
  organizationSlug,
  userId,
  officeChangeCount,
  officeChangeLimit,
}: OfficeChangesCardProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [resetting, setResetting] = useState(false)

  async function handleReset() {
    setResetting(true)
    try {
      const { error } = await resetOfficeChanges(organizationSlug, userId)
      if (error) {
        showToast(error)
      } else {
        showToast('Office changes reset')
        router.refresh()
      }
    } catch (error) {
      showToast(describeActionFailure(error, 'Failed to reset office changes'))
    }
    setResetting(false)
  }

  return (
    <InfoCard
      title="Office Changes"
      action={
        <ProtectedContent
          requiredPermission={PERMISSIONS.WRITE_CAMPAIGNS}
          hideWhenUnauthorized
        >
          <Button
            size="1"
            variant="outline"
            onClick={handleReset}
            disabled={resetting || officeChangeCount === 0}
          >
            {resetting ? 'Resetting...' : 'Reset'}
          </Button>
        </ProtectedContent>
      }
    >
      <DataRow label="Used">
        {officeChangeCount} of {officeChangeLimit}
      </DataRow>
      {officeChangeCount >= officeChangeLimit && (
        <Text size="1" color="red" as="p" mt="2">
          Limit reached. The user can&apos;t change their office until it is
          reset.
        </Text>
      )}
    </InfoCard>
  )
}
