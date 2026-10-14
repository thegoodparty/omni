import { Dialog, DialogContent, DialogTitle } from '@styleguide'
import { SMS_CUTOFF_COPY } from 'app/dashboard/campaign-verification/verificationCopy'
import { SmsCutoffNotice } from './SmsCutoffNotice'

interface SmsCutoffNoticeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  surface: string
}

// The notice for a surface with no screen of its own to replace: the
// membership banner and chip, the closed text tile, and a `?compose=text`
// arrival.
export const SmsCutoffNoticeDialog = ({
  open,
  onOpenChange,
  surface,
}: SmsCutoffNoticeDialogProps): React.JSX.Element => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      aria-describedby={undefined}
      className="max-h-[88vh] overflow-y-auto rounded-2xl p-6 sm:max-w-lg sm:p-8"
    >
      <DialogTitle className="sr-only">{SMS_CUTOFF_COPY.title}</DialogTitle>
      <SmsCutoffNotice
        variant="screen"
        surface={surface}
        onPick={() => onOpenChange(false)}
      />
    </DialogContent>
  </Dialog>
)
