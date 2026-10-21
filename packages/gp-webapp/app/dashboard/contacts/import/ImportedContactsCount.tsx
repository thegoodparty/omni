import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

export const IMPORT_CONTACTS_POC_ENABLED =
  process.env.NEXT_PUBLIC_POC_IMPORT_CONTACTS_ENABLED === 'true'

export const ImportedContactsCount = () => {
  const { data, isPending, isError } = useQuery({
    queryKey: ['poc-import-contacts-counts'],
    queryFn: async () =>
      (await clientRequest('GET /v1/poc/contacts/counts', {})).data,
  })
  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        Counting imported contacts...
      </p>
    )
  }
  if (isError) return null
  return (
    <p className="text-sm text-muted-foreground" data-testid="imported-counts">
      {data.contacts} imported: {data.verified} verified, {data.unverified}{' '}
      unverified, of {data.total} people.
    </p>
  )
}
