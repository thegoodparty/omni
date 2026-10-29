import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { isNotNil } from 'es-toolkit'
import { LuContact } from 'react-icons/lu'
import type { ContactFieldSource } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import Map from '@shared/utils/Map'
import { InfoSection } from './InfoSection'
import type { Person } from '../shared/contacts-types'
import { useContactSources } from '../import/importContactsApi'
import { ChangeMatchDialog } from '../import/ChangeMatchDialog'
import {
  SERVE_IMPORT_CONTACTS_COPY,
  formatUploadDate,
  uploadDetailPath,
} from '../import/importContactsCopy'

const COPY = SERVE_IMPORT_CONTACTS_COPY.person

// `email` joins the Person contract with Import contacts; read it without
// assuming the contract this build was compiled against already carries it.
type PersonWithEmail = Person & { email?: string | null }

const CameFrom = ({ source }: { source: ContactFieldSource | null }) => {
  if (!source) return null
  if (source.kind === 'constituent_file') {
    return <p className="text-sm text-muted-foreground">{COPY.cameFromFile}</p>
  }
  return (
    <Link
      href={uploadDetailPath(source.uploadId)}
      className="text-sm text-link underline underline-offset-4"
    >
      {COPY.cameFromUpload(source.uploadName)}
    </Link>
  )
}

const Field = ({
  label,
  value,
  source,
}: {
  label: string
  value: ReactNode | string | null
  source: ContactFieldSource | null
}) => (
  <div className="flex flex-col gap-1">
    <p className="text-sm text-muted-foreground">{label}</p>
    <div className="text-md">{value ?? 'Unknown'}</div>
    {value !== null && <CameFrom source={source} />}
  </div>
)

// Serve's Contact Information with Import contacts on: today's card plus
// Email, a line under each detail saying where it came from, and Change match
// when an upload row points at this person.
export const ImportedContactInformation = ({
  person,
  showMap,
}: {
  person: PersonWithEmail
  showMap: boolean
}) => {
  const sourcesQuery = useContactSources(person.id)
  const sources = sourcesQuery.data
  const [changeOpen, setChangeOpen] = useState(false)
  const name = [person.firstName, person.lastName, person.nameSuffix]
    .filter(isNotNil)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const uploadRows = sources?.uploadRows ?? []

  return (
    <InfoSection title="Contact Information" icon={<LuContact size={24} />}>
      <Field
        label="Address"
        value={
          person.address.line1 || person.address.city || person.address.zip ? (
            <>
              <p>{person.address.line1}</p>
              {person.address.line2 && <p>{person.address.line2}</p>}
              <p>
                {person.address.city}, {person.address.state}{' '}
                {person.address.zip}
              </p>
            </>
          ) : null
        }
        source={sources?.fields.address ?? null}
      />
      {showMap && person.address.latitude && person.address.longitude && (
        <Map
          places={[
            {
              lat: person.address.latitude,
              lng: person.address.longitude,
              title: name,
              description: [
                person.address.line1,
                person.address.line2,
                person.address.city,
                person.address.state,
                person.address.zip,
              ]
                .filter(isNotNil)
                .join(', '),
            },
          ]}
          height="200px"
        />
      )}
      <Field
        label={COPY.email}
        value={person.email ?? null}
        source={sources?.fields.email ?? null}
      />
      <Field
        label="Cell Phone Number"
        value={person.cellPhone}
        source={sources?.fields.cellPhone ?? null}
      />
      <Field
        label="Landline"
        value={person.landline}
        source={sources?.fields.landline ?? null}
      />
      {uploadRows.length > 0 && (
        <>
          <Button
            variant="outline"
            size="small"
            className="self-start"
            onClick={() => setChangeOpen(true)}
          >
            {COPY.changeMatch}
          </Button>
          <ChangeMatchDialog
            open={changeOpen}
            onOpenChange={setChangeOpen}
            rows={uploadRows.map((row) => ({
              rowId: row.rowId,
              uploadId: row.uploadId,
              label: COPY.uploadRow(
                row.uploadName,
                formatUploadDate(row.uploadedAt),
              ),
            }))}
            description={
              uploadRows.length === 1 && uploadRows[0]
                ? SERVE_IMPORT_CONTACTS_COPY.changeMatch.fromUpload(
                    uploadRows[0].uploadName,
                  )
                : undefined
            }
            currentPersonId={person.id}
            currentPersonName={name}
          />
        </>
      )}
    </InfoSection>
  )
}
