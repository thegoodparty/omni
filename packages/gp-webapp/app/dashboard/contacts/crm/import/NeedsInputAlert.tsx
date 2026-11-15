import Link from 'next/link'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  InfoIcon,
} from '@styleguide'
import type { ContactUpload } from '@goodparty_org/contracts'
import {
  getImportContactsCopy,
  UPLOAD_HISTORY_PATH,
  uploadDetailPath,
} from './importContactsCopy'

export const NeedsInputAlert = ({
  uploads,
  isWin,
}: {
  uploads: ContactUpload[]
  isWin: boolean
}) => {
  const COPY = getImportContactsCopy(isWin).needsInputAlert
  const waiting = uploads.filter((upload) => upload.status === 'needs_input')
  const [only] = waiting
  if (!only) return null

  const single = waiting.length === 1
  return (
    <Alert variant="info" icon={<InfoIcon />}>
      <AlertTitle>
        {single
          ? COPY.oneTitle(only.needsInputCount, only.name)
          : COPY.manyTitle(waiting.length)}
      </AlertTitle>
      <AlertDescription>
        {single ? COPY.oneBody : COPY.manyBody}
      </AlertDescription>
      <AlertAction>
        <Button variant="alertOutline" size="small" asChild>
          <Link href={single ? uploadDetailPath(only.id) : UPLOAD_HISTORY_PATH}>
            {single ? COPY.review : COPY.seeImports}
          </Link>
        </Button>
      </AlertAction>
    </Alert>
  )
}
