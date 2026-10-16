import { Dialog, DialogContent, DialogTitle } from '@styleguide'
import {
  SMS_CUTOFF_COPY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { SmsCutoffNotice } from './SmsCutoffNotice'
import { useSmsCompliance } from './useSmsCompliance'

interface SmsCutoffNoticeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  surface: string
}

// The notice for a surface with no screen of its own to replace: a
// `?compose=text` arrival and the legacy text gate, which only a deep link
// or a resumed draft can still reach once texting is closed.
export const SmsCutoffNoticeDialog = ({
  open,
  onOpenChange,
  surface,
}: SmsCutoffNoticeDialogProps): React.JSX.Element => {
  const { smsCutoffDate } = useSmsCompliance()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[88vh] overflow-y-auto rounded-2xl p-6 sm:max-w-lg sm:p-8"
      >
        <DialogTitle className="sr-only">
          {SMS_CUTOFF_COPY.closedReason(
            smsCutoffDate ? formatSmsCutoffDate(smsCutoffDate) : null,
          )}
        </DialogTitle>
        <SmsCutoffNotice
          variant="screen"
          surface={surface}
          onPick={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
