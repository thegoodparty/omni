'use client'

import { Callout } from '@radix-ui/themes'
import { HiExclamationCircle } from 'react-icons/hi'
import {
  GP_API_ACCESS_DENIED_DIGEST,
  GP_API_ACCESS_DENIED_MESSAGE,
} from '@/shared/util/actionFailure.util'

const DashboardError = ({ error }: { error: Error & { digest?: string } }) => {
  if (error.digest !== GP_API_ACCESS_DENIED_DIGEST) {
    throw error
  }

  return (
    <Callout.Root color="red">
      <Callout.Icon>
        <HiExclamationCircle />
      </Callout.Icon>
      <Callout.Text>{GP_API_ACCESS_DENIED_MESSAGE}</Callout.Text>
    </Callout.Root>
  )
}

export default DashboardError
