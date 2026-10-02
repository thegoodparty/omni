import { Alert, AlertDescription, LoaderCircleIcon } from '@styleguide'
import { whatWeHeardCopy } from '../../copy'

// What the report says while a run is in flight. A status, not an alert:
// nothing is wrong, and the notes stay listed under it so the page is still
// worth reading while it waits.
export default function SummarizingBanner({ isServe }: { isServe: boolean }) {
  return (
    <Alert
      variant="info"
      role="status"
      icon={<LoaderCircleIcon className="animate-spin" />}
    >
      <AlertDescription>
        {whatWeHeardCopy(isServe).summarizing}
      </AlertDescription>
    </Alert>
  )
}
