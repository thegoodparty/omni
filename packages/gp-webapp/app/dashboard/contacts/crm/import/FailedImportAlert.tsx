import Link from 'next/link'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  XCircleIcon,
} from '@styleguide'
import type { ContactUpload } from '@goodparty_org/contracts'
import {
  getImportContactsCopy,
  UPLOAD_HISTORY_PATH,
  uploadDetailPath,
} from './importContactsCopy'

export const FailedImportAlert = ({
  uploads,
  isWin,
}: {
  uploads: ContactUpload[]
  isWin: boolean
}) => {
  const COPY = getImportContactsCopy(isWin).failedAlert
  // A failed upload stays failed when the user imports a fixed file instead
  // of retrying, so only failures newer than the last upload that worked
  // count; otherwise the alert would never go away.
  const lastWorked = uploads
    .filter((upload) => upload.status !== 'failed')
    .reduce(
      (latest, upload) =>
        upload.createdAt > latest ? upload.createdAt : latest,
      '',
    )
  const failed = uploads.filter(
    (upload) => upload.status === 'failed' && upload.createdAt > lastWorked,
  )
  const [only] = failed
  if (!only) return null

  const single = failed.length === 1
  return (
    <Alert variant="destructive" icon={<XCircleIcon />}>
      <AlertTitle>
        {single ? COPY.oneTitle(only.name) : COPY.manyTitle(failed.length)}
      </AlertTitle>
      <AlertDescription>
        {single ? COPY.oneBody : COPY.manyBody}
      </AlertDescription>
      <AlertAction>
        <Button variant="alertOutline" size="small" asChild>
          <Link href={single ? uploadDetailPath(only.id) : UPLOAD_HISTORY_PATH}>
            {single ? COPY.open : COPY.seeImports}
          </Link>
        </Button>
      </AlertAction>
    </Alert>
  )
}
