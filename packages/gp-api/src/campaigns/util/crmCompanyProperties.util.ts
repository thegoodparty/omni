import { CRMCompanyProperties } from 'src/crm/schemas/CRMCompanyProperties.schema'

export type CRMCompanyPropertyField = keyof CRMCompanyProperties | 'all'

/**
 * Narrows a full set of computed CRM company properties down to the subset that
 * should be sent in a HubSpot update. When `fields` is exactly `['all']` the
 * properties are returned untouched; otherwise only the requested fields with a
 * truthy (or explicitly `null`) value are carried through.
 */
export function filterPropertiesForUpdate(
  crmCompanyProperties: CRMCompanyProperties,
  fields: Array<CRMCompanyPropertyField>,
) {
  const includeAll = fields.length === 1 && fields.includes('all')

  return includeAll
    ? crmCompanyProperties
    : fields.reduce(
        (acc: Record<string, string | number | undefined>, field) => {
          if (field === 'all') {
            return acc
          }
          if (
            crmCompanyProperties[field] ||
            crmCompanyProperties[field] === null
          ) {
            acc[field] = crmCompanyProperties[field]
          }
          return acc
        },
        {},
      )
}
