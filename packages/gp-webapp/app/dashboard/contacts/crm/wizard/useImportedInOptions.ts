import type { ContactUploadStatus } from '@goodparty_org/contracts'
import { useServeImportContactsFlag } from 'app/shared/experiments/serveImportContactsFlag'
import { useContactUploads } from '../import/importContactsApi'

export interface ImportedInOption {
  id: string
  name: string
}

export interface ImportedInOptionsResult {
  options: ImportedInOption[]
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

// A failed upload added nobody. One still processing is offered: the list
// reads the people it has added so far, and the rest as they land.
const IMPORTED_IN_STATUSES: readonly ContactUploadStatus[] = [
  'complete',
  'needs_input',
  'processing',
]

// The org's imports, by the name the user gave each, for the builder's
// "Imported in" group. Behind the same flag as Import contacts; `enabled` is
// the caller's own gate (the builder is shut, Win without Pro).
export const useImportedInOptions = (
  enabled: boolean,
): ImportedInOptionsResult => {
  const { enabled: importOn } = useServeImportContactsFlag(false)
  const query = useContactUploads(enabled && importOn)
  return {
    options: (query.data?.uploads ?? [])
      .filter((upload) => IMPORTED_IN_STATUSES.includes(upload.status))
      .map((upload) => ({ id: upload.id, name: upload.name })),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  }
}
