import type { ReactNode } from 'react'
import type { ContactUploadStatus } from '@goodparty_org/contracts'
import { StatusText } from '@styleguide'
import {
  CheckCircleIcon,
  CircleDotIcon,
  ClockIcon,
  Loader2Icon,
  ShieldAlertIcon,
} from '@styleguide/components/ui/icons'
import { getImportContactsCopy } from './importContactsCopy'

// The outreach history's marks and tones (channelMeta.tsx STATUS_DISPLAY), so
// an import and an outreach in the same state read the same: In progress,
// Done, Pending payment (waiting on you) and Couldn't send.
const STATUS_DISPLAY: Record<
  ContactUploadStatus,
  { icon: ReactNode; tone: 'primary' | 'warning' | 'destructive' }
> = {
  awaiting_file: { icon: <Loader2Icon />, tone: 'primary' },
  processing: { icon: <CircleDotIcon />, tone: 'primary' },
  needs_input: { icon: <ClockIcon />, tone: 'warning' },
  complete: { icon: <CheckCircleIcon />, tone: 'primary' },
  failed: { icon: <ShieldAlertIcon />, tone: 'destructive' },
}

export const UploadStatusText = ({
  status,
  isWin,
}: {
  status: ContactUploadStatus
  isWin: boolean
}) => (
  <StatusText
    tone={STATUS_DISPLAY[status].tone}
    icon={STATUS_DISPLAY[status].icon}
    spinning={status === 'awaiting_file'}
  >
    {getImportContactsCopy(isWin).status[status]}
  </StatusText>
)
