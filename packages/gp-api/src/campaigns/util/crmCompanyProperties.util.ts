import { CRMCompanyProperties } from 'src/crm/schemas/CRMCompanyProperties.schema'

export type CRMCompanyPropertyField = keyof CRMCompanyProperties | 'all'

// The validated CRMCompanyProperties type only ever holds string values, but the
// filter below explicitly carries `null` through — that null is how a HubSpot
// field gets cleared. Model the input honestly (each prop optionally `null`) so
// that field-clearing branch stays type-reachable rather than dead per the type.
export type CRMCompanyPropertiesInput = {
  [K in keyof CRMCompanyProperties]?: CRMCompanyProperties[K] | null
}

/**
 * Narrows a full set of computed CRM company properties down to the subset that
 * should be sent in a HubSpot update. When `fields` is exactly `['all']` the
 * properties are returned untouched; otherwise only the requested fields with a
 * truthy (or explicitly `null`) value are carried through.
 */
export function filterPropertiesForUpdate(
  crmCompanyProperties: CRMCompanyPropertiesInput,
  fields: Array<CRMCompanyPropertyField>,
) {
  const includeAll = fields.length === 1 && fields.includes('all')

  return includeAll
    ? crmCompanyProperties
    : fields.reduce(
        (acc: Record<string, string | number | null | undefined>, field) => {
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
