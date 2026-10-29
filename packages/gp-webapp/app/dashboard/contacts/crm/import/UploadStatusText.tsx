import type { ReactNode } from 'react'
import type { ContactUploadStatus } from '@goodparty_org/contracts'
import {
  CheckCircleIcon,
  CircleAlertIcon,
  Loader2Icon,
  StatusText,
  XCircleIcon,
} from '@styleguide'
import { SERVE_IMPORT_CONTACTS_COPY } from './importContactsCopy'

const STATUS_DISPLAY: Record<
  ContactUploadStatus,
  { icon: ReactNode; tone: 'primary' | 'warning' | 'success' | 'destructive' }
> = {
  processing: { icon: <Loader2Icon />, tone: 'primary' },
  needs_input: { icon: <CircleAlertIcon />, tone: 'warning' },
  complete: { icon: <CheckCircleIcon />, tone: 'success' },
  failed: { icon: <XCircleIcon />, tone: 'destructive' },
}

export const UploadStatusText = ({
  status,
}: {
  status: ContactUploadStatus
}) => (
  <StatusText
    tone={STATUS_DISPLAY[status].tone}
    icon={STATUS_DISPLAY[status].icon}
    spinning={status === 'processing'}
  >
    {SERVE_IMPORT_CONTACTS_COPY.status[status]}
  </StatusText>
)
