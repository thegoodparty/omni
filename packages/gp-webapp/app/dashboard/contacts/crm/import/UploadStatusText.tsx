import type { ReactNode } from 'react'
import type { ContactUploadStatus } from '@goodparty_org/contracts'
import {
  CheckCircleIcon,
  CircleAlertIcon,
  Loader2Icon,
  StatusText,
  XCircleIcon,
} from '@styleguide'
import { getImportContactsCopy } from './importContactsCopy'

const STATUS_DISPLAY: Record<
  ContactUploadStatus,
  { icon: ReactNode; tone: 'primary' | 'warning' | 'success' | 'destructive' }
> = {
  awaiting_file: { icon: <Loader2Icon />, tone: 'primary' },
  processing: { icon: <Loader2Icon />, tone: 'primary' },
  needs_input: { icon: <CircleAlertIcon />, tone: 'warning' },
  complete: { icon: <CheckCircleIcon />, tone: 'success' },
  failed: { icon: <XCircleIcon />, tone: 'destructive' },
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
    spinning={status === 'processing' || status === 'awaiting_file'}
  >
    {getImportContactsCopy(isWin).status[status]}
  </StatusText>
)
